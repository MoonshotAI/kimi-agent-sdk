package jsonrpc2

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/rpc"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const JSONRPC2Version = "2.0"

func NewCodec(rwc io.ReadWriteCloser, options ...CodecOption) *Codec {
	donectx, cancel := context.WithCancel(context.Background())
	codec := &Codec{
		donectx:   donectx,
		cancel:    cancel,
		rwc:       rwc,
		enc:       json.NewEncoder(rwc),
		dec:       json.NewDecoder(rwc),
		srvreqids: make(map[uint64]string),
		clireqids: make(map[string]uint64),
		reqmeth:   make(map[string]string),
		outpls:    make(chan *Payload),
		inreqs:    make(chan Request),
		inress:    make(chan Response),
	}
	for _, apply := range options {
		apply(codec)
	}
	codec.wg.Go(codec.send)
	codec.wg.Go(codec.recv)
	return codec
}

type CodecOption func(*Codec)

func ClientMethodRenamer(renamer Renamer) CodecOption {
	return func(codec *Codec) {
		codec.clientMethodRenamer = renamer
	}
}

func ServerMethodRenamer(renamer Renamer) CodecOption {
	return func(codec *Codec) {
		codec.serverMethodRenamer = renamer
	}
}

func JSONIDGenerator(generator Generator[string]) CodecOption {
	return func(codec *Codec) {
		codec.jsonidGenerator = generator
	}
}

func ShutdownTimeout(timeout time.Duration) CodecOption {
	return func(codec *Codec) {
		codec.shutdownTimeout = timeout
	}
}

type Codec struct {
	clientMethodRenamer Renamer
	serverMethodRenamer Renamer
	jsonidGenerator     Generator[string]
	shutdownTimeout     time.Duration

	donectx context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup

	rwc io.ReadWriteCloser
	enc *json.Encoder
	dec *json.Decoder
	err atomic.Value

	// inflight counts decoded requests that have not yet been registered in srvreqids.
	// This closes a race window between recv() delivering a request and ReadRequestHeader()
	// adding it to srvreqids.
	inflight atomic.Int64

	srvlock   sync.Mutex
	seq       uint64
	srvreqids map[uint64]string
	thisreq   Request

	clilock     sync.Mutex
	clireqids   map[string]uint64
	reqmeth     map[string]string
	thisres     Response
	rxcloseonce sync.Once

	outpls      chan *Payload
	txcloseonce sync.Once

	inreqs chan Request
	inress chan Response
}

func (c *Codec) loadOrFallbackErr(fallback error) error {
	if werr := c.err.Load(); werr != nil {
		if err := werr.(error); errors.Is(err, io.EOF) {
			return io.EOF
		} else if errors.Is(err, io.ErrUnexpectedEOF) {
			return io.ErrUnexpectedEOF
		} else if we := new(wraperror); errors.As(err, &we) {
			return we.Unwrap()
		} else {
			return err
		}
	}
	return fallback
}

func (c *Codec) send() {
	for payload := range c.outpls {
		if err := c.enc.Encode(payload); err != nil {
			c.cancel()
			c.err.CompareAndSwap(nil, &wraperror{err})
			return
		}
	}
}

func (c *Codec) recv() {
	defer c.txcloseonce.Do(func() {
		close(c.inreqs)
		close(c.inress)
	})
	for {
		var payload Payload
		if err := c.dec.Decode(&payload); err != nil {
			c.cancel()
			c.err.CompareAndSwap(nil, &wraperror{err})
			return
		}
		if payload.Method != "" {
			c.inflight.Add(1)
			select {
			case c.inreqs <- &payload:
			case <-c.donectx.Done():
				c.inflight.Add(-1)
				return
			}
		} else {
			select {
			case c.inress <- &payload:
			case <-c.donectx.Done():
				return
			}
		}
	}
}

func (c *Codec) ReadRequestHeader(r *rpc.Request) error {
	var ok bool
	select {
	case c.thisreq, ok = <-c.inreqs:
		if !ok {
			return c.loadOrFallbackErr(io.EOF)
		}
	case <-c.donectx.Done():
		return c.loadOrFallbackErr(io.EOF)
	}
	if renamer := c.serverMethodRenamer; renamer != nil {
		r.ServiceMethod = renamer.Rename(c.thisreq.GetMethod())
	} else {
		r.ServiceMethod = c.thisreq.GetMethod()
	}
	c.srvlock.Lock()
	c.seq++
	c.srvreqids[c.seq] = c.thisreq.GetID()
	r.Seq = c.seq
	c.inflight.Add(-1)
	c.srvlock.Unlock()
	return nil
}

func (c *Codec) ReadRequestBody(x any) error {
	if x == nil {
		return nil
	}
	if err := json.Unmarshal(c.thisreq.GetParams(), x); err != nil {
		return c.loadOrFallbackErr(err)
	}
	return nil
}

func (c *Codec) WriteResponse(r *rpc.Response, x any) error {
	defer func() {
		c.srvlock.Lock()
		delete(c.srvreqids, r.Seq)
		c.srvlock.Unlock()
	}()
	c.srvlock.Lock()
	reqid := c.srvreqids[r.Seq]
	c.srvlock.Unlock()
	if reqid != "" {
		if r.Error == "" {
			result, err := json.Marshal(x)
			if err != nil {
				return c.loadOrFallbackErr(err)
			}
			select {
			case c.outpls <- &Payload{
				Version: JSONRPC2Version,
				ID:      reqid,
				Result:  result,
			}:
			case <-c.donectx.Done():
				return c.loadOrFallbackErr(io.EOF)
			}
		} else {
			errmsg := json.RawMessage(r.Error)
			if !json.Valid(errmsg) {
				errmsg, _ = json.Marshal(r.Error)
			}
			select {
			case c.outpls <- &Payload{
				Version: JSONRPC2Version,
				ID:      reqid,
				Error:   errmsg,
			}:
			case <-c.donectx.Done():
				return c.loadOrFallbackErr(io.EOF)
			}
		}
	}
	return nil
}

func (c *Codec) WriteRequest(r *rpc.Request, x any) error {
	params, err := json.Marshal(x)
	if err != nil {
		return c.loadOrFallbackErr(err)
	}
	var reqid string
	if generator := c.jsonidGenerator; generator != nil {
		reqid = generator.Generate()
	} else {
		reqid = strconv.FormatUint(r.Seq, 10)
	}
	c.clilock.Lock()
	c.clireqids[reqid] = r.Seq
	c.reqmeth[reqid] = r.ServiceMethod
	c.clilock.Unlock()
	var method string
	if renamer := c.clientMethodRenamer; renamer != nil {
		method = renamer.Rename(r.ServiceMethod)
	} else {
		method = r.ServiceMethod
	}
	select {
	case c.outpls <- &Payload{
		Version: JSONRPC2Version,
		Method:  method,
		ID:      reqid,
		Params:  params,
	}:
	case <-c.donectx.Done():
		return c.loadOrFallbackErr(io.EOF)
	}
	return nil
}

func (c *Codec) ReadResponseHeader(r *rpc.Response) error {
	var ok bool
	select {
	case c.thisres, ok = <-c.inress:
		if !ok {
			return c.loadOrFallbackErr(io.EOF)
		}
	case <-c.donectx.Done():
		return c.loadOrFallbackErr(io.EOF)
	}
	id := c.thisres.GetID()
	c.clilock.Lock()
	r.ServiceMethod = c.reqmeth[id]
	r.Seq = c.clireqids[id]
	delete(c.reqmeth, id)
	delete(c.clireqids, id)
	c.clilock.Unlock()
	if len(c.thisres.GetError()) > 0 {
		r.Error = string(c.thisres.GetError())
	}
	return nil
}

func (c *Codec) ReadResponseBody(x any) error {
	if x == nil {
		return nil
	}
	if err := json.Unmarshal(c.thisres.GetResult(), x); err != nil {
		return c.loadOrFallbackErr(err)
	}
	return nil
}

func (c *Codec) PendingServerRequests() int {
	c.srvlock.Lock()
	defer c.srvlock.Unlock()
	return len(c.srvreqids)
}

func (c *Codec) PendingClientRequests() int {
	c.clilock.Lock()
	defer c.clilock.Unlock()
	return len(c.clireqids)
}

func (c *Codec) PendingRequests() int {
	pending := c.PendingServerRequests() + c.PendingClientRequests()
	if inflight := c.inflight.Load(); inflight > 0 {
		pending += int(inflight)
	}
	return pending
}

func (c *Codec) Close() error {
	defer c.wg.Wait()
	c.cancel()
	c.err.CompareAndSwap(nil, &wraperror{io.EOF})
	timeout := c.shutdownTimeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
gracefulshutdown:
	for {
		select {
		case <-timer.C:
			break gracefulshutdown
		default:
			pending := c.PendingRequests()
			if pending == 0 {
				break gracefulshutdown
			}
			time.Sleep(time.Duration(pending) * time.Second)
		}
	}
	c.rxcloseonce.Do(func() {
		close(c.outpls)
	})
	c.txcloseonce.Do(func() {
		close(c.inreqs)
		close(c.inress)
	})
	return c.rwc.Close()
}

type Payload struct {
	Version string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

func (p *Payload) GetID() string              { return p.ID }
func (p *Payload) GetMethod() string          { return p.Method }
func (p *Payload) GetParams() json.RawMessage { return p.Params }
func (p *Payload) GetResult() json.RawMessage { return p.Result }
func (p *Payload) GetError() json.RawMessage  { return p.Error }

type Request interface {
	GetID() string
	GetMethod() string
	GetParams() json.RawMessage
}

type Response interface {
	GetID() string
	GetResult() json.RawMessage
	GetError() json.RawMessage
}

type (
	Renamer              interface{ Rename(string) string }
	RenamerFunc          func(string) string
	Generator[T any]     interface{ Generate() T }
	GeneratorFunc[T any] func() T
)

func (f RenamerFunc) Rename(s string) string { return f(s) }
func (f GeneratorFunc[T]) Generate() T       { return f() }
