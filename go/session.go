package kimi

import (
	"context"
	"errors"
	"io"
	"net/rpc"
	"os/exec"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire/jsonrpc2"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire/transport"
)

var (
	tpname = reflect.TypeOf((*transport.Transport)(nil)).Elem().Name()
)

func NewSession(options ...Option) (*Session, error) {
	args := []string{"kimi"}
	for _, f := range options {
		args = append(args, f(args)...)
	}
	args = append(args, "--wire")
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	codec := jsonrpc2.NewCodec(&stdio{stdin, stdout},
		jsonrpc2.ClientMethodRenamer(jsonrpc2.RenamerFunc(func(method string) string {
			return strings.ToLower(strings.TrimPrefix(method, tpname+"."))
		})),
		jsonrpc2.ServerMethodRenamer(jsonrpc2.RenamerFunc(func(method string) string {
			return tpname + "." + cases.Title(language.English).String(method)
		})),
	)
	session := &Session{
		ctx:   ctx,
		cmd:   cmd,
		codec: codec,
		tp:    transport.NewTransportClient(rpc.NewClientWithCodec(codec)),
	}
	responder := transport.NewTransportServer(&Responder{
		rwlock: &session.rwlock,
		msgs:   &session.msgs,
		usrc:   &session.usrc,
	})
	go session.serve(responder)
	watch := func() {
		cmd.Wait()
		stdin.Close()
		stdout.Close()
		cancel()
	}
	go watch()
	return session, nil
}

type Session struct {
	ctx    context.Context
	cmd    *exec.Cmd
	codec  *jsonrpc2.Codec
	rwlock sync.RWMutex
	msgs   chan wire.Message
	usrc   chan wire.RequestResponse
	tp     transport.Transport
}

func (s *Session) serve(responder *transport.TransportServer) {
	server := rpc.NewServer()
	server.RegisterName(tpname, responder)
	for {
		if err := server.ServeRequest(s.codec); err != nil {
			return
		}
	}
}

func wait(codec *jsonrpc2.Codec) {
	for {
		pending := codec.PendingRequests()
		if pending == 0 {
			return
		}
		time.Sleep(time.Duration(pending) * time.Second)
	}
}

func (s *Session) RoundTrip(ctx context.Context, content wire.Content) (*Turn, error) {
	var (
		bg     sync.WaitGroup
		msgs   = make(chan wire.Message)
		usrc   = make(chan wire.RequestResponse, 1)
		errc1  = make(chan error, 1)
		errc2  = make(chan error, 1)
		resc   = make(chan struct{}, 1)
		result = new(atomic.Pointer[wire.PromptResult])
	)
	defer close(errc1)
	defer close(errc2)
	defer close(resc)
	s.rwlock.Lock()
	s.msgs = msgs
	s.usrc = usrc
	s.rwlock.Unlock()
	bg.Go(func() {
		msg0 := <-msgs
		if _, ok := msg0.(wire.TurnBegin); !ok {
			errc1 <- ErrTurnNotFound
			return
		}
		resc <- struct{}{}
	})
	bg.Go(func() {
		cleanup := func() {
			wait(s.codec)
			s.rwlock.Lock()
			s.msgs = nil
			s.usrc = nil
			s.rwlock.Unlock()
			close(msgs)
		}
		defer cleanup()
		result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})
		rpcresult, err := s.tp.Prompt(&wire.PromptParams{
			UserInput: content,
		})
		if err != nil {
			errc2 <- err
			return
		}
		result.Store(rpcresult)
	})
	exit := func(err error) error {
		for range msgs {
		}
		bg.Wait()
		select {
		case <-s.ctx.Done():
			if state := s.cmd.ProcessState; state.ExitCode() > 0 {
				return errors.New(state.String())
			}
		default:
		}
		if err != nil {
			return err
		}
		return nil
	}
	select {
	case <-resc:
		return turnBegin(ctx, s.tp, result, msgs, usrc, exit), nil
	case err := <-errc1:
		return nil, exit(err)
	case err := <-errc2:
		return nil, exit(err)
	case <-ctx.Done():
		return nil, exit(ctx.Err())
	}
}

type Responder struct {
	transport.Transport
	rwlock *sync.RWMutex
	msgs   *chan wire.Message
	usrc   *chan wire.RequestResponse
}

func (r *Responder) Event(event *wire.EventParams) (*wire.EventResult, error) {
	r.rwlock.RLock()
	defer r.rwlock.RUnlock()
	if *r.msgs != nil {
		*r.msgs <- event.Payload
	}
	return &wire.EventResult{}, nil
}

func (r *Responder) Request(request *wire.RequestParams) (*wire.RequestResult, error) {
	r.rwlock.RLock()
	defer r.rwlock.RUnlock()
	if *r.msgs == nil || *r.usrc == nil {
		return &wire.RequestResult{
			RequestID: request.Payload.RequestID(),
			Response:  wire.RequestResponseReject,
		}, nil
	}
	var wr wire.Request
	switch payload := request.Payload.(type) {
	case wire.ApprovalRequest:
		payload.Responder = ResponderFunc(func(rr wire.RequestResponse) error {
			*r.usrc <- rr
			return nil
		})
		wr = payload
	}
	*r.msgs <- wr
	return &wire.RequestResult{
		RequestID: request.Payload.RequestID(),
		Response:  <-*r.usrc,
	}, nil
}

func (s *Session) Close() error {
	return errors.Join(
		s.codec.Close(),
		s.cmd.Cancel(),
	)
}

type stdio struct {
	io.WriteCloser
	io.ReadCloser
}

func (s *stdio) Close() error {
	return errors.Join(
		s.WriteCloser.Close(),
		s.ReadCloser.Close(),
	)
}

type ResponderFunc func(wire.RequestResponse) error

func (f ResponderFunc) Respond(r wire.RequestResponse) error {
	return f(r)
}
