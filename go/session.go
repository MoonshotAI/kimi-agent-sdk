package kimi

import (
	"context"
	"errors"
	"io"
	"net/rpc"
	"os"
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
	opt := &option{
		exec: "kimi",
		args: []string{"--wire"},
		envs: os.Environ(),
	}
	for _, f := range options {
		if f != nil {
			f(opt)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, opt.exec, opt.args...)
	cmd.Env = append(cmd.Env, opt.envs...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		cancel()
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
	seq    uint64
	turns  []*Turn
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
		id     = atomic.AddUint64(&s.seq, 1)
		msgs   = make(chan wire.Message)
		usrc   = make(chan wire.RequestResponse)
		errc1  = make(chan error)
		errc2  = make(chan error)
		resc   = make(chan struct{})
		result = new(atomic.Pointer[wire.PromptResult])
	)
	s.rwlock.Lock()
	s.msgs = msgs
	s.usrc = usrc
	s.rwlock.Unlock()
	bg.Go(func() {
		defer close(resc)
		defer close(errc1)
		msg0, ok := <-msgs
		if !ok {
			return
		}
		if _, ok = msg0.(wire.TurnBegin); !ok {
			select {
			case errc1 <- ErrTurnNotFound:
			case <-ctx.Done():
			}
			return
		}
		select {
		case resc <- struct{}{}:
		case <-ctx.Done():
		}
	})
	var (
		ok = make(chan struct{})
		ep atomic.Pointer[error]
	)
	bg.Go(func() {
		cleanup := func() {
			wait(s.codec)
			s.rwlock.Lock()
			s.msgs = nil
			s.usrc = nil
			s.rwlock.Unlock()
			close(msgs)
			close(errc2)
		}
		defer cleanup()
		result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})
		rpcresult, err := s.tp.Prompt(&wire.PromptParams{
			UserInput: content,
		})
		if err != nil {
			select {
			case errc2 <- err:
				close(ok)
			case <-ok:
				ep.Store(&err)
			case <-ctx.Done():
			}
			return
		}
		select {
		case <-ok:
		case <-ctx.Done():
			return
		}
		result.Store(rpcresult)
	})
	exit := func(err error) error {
		for range msgs {
		}
		bg.Wait()
		s.rwlock.Lock()
		for i, turn := range s.turns {
			if turn.id == id {
				s.turns[i] = s.turns[len(s.turns)-1]
				s.turns = s.turns[:len(s.turns)-1]
				break
			}
		}
		s.rwlock.Unlock()
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
		close(ok)
		turn := turnBegin(ctx, id, s.tp, &ep, result, msgs, usrc, exit)
		s.rwlock.Lock()
		s.turns = append(s.turns, turn)
		s.rwlock.Unlock()
		return turn, nil
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
	defer s.codec.Close()
	s.rwlock.Lock()
	cancels := make([]func() error, len(s.turns))
	for i, turn := range s.turns {
		cancels[i] = turn.Cancel
	}
	s.turns = nil
	s.rwlock.Unlock()
	for _, cancel := range cancels {
		cancel() //nolint:errcheck
	}
	return s.cmd.Cancel()
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
