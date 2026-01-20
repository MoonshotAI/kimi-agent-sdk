package jsonrpc2

import (
	"container/list"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/rpc"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const JSONRPC2Version = "2.0"

func NewCodec(rwc io.ReadWriteCloser, options ...CodecOption) *Codec {
	donectx, cancel := context.WithCancel(context.Background())
	codec := &Codec{
		donectx:        donectx,
		cancel:         cancel,
		rwc:            rwc,
		enc:            json.NewEncoder(rwc),
		dec:            json.NewDecoder(rwc),
		srvreqids:      make(map[uint64]string),
		clireqids:      make(map[string]uint64),
		reqmeth:        make(map[string]string),
		outpls:         make(chan *Payload),
		inreqs:         make(chan Request),
		inress:         make(chan Response),
		senders:        make(map[string]<-chan json.RawMessage),
		senderwaker:    make(chan string),
		receivers:      make(map[string]chan<- json.RawMessage),
		receiverwaker:  make(chan string),
		receivercloser: make(chan string),
		receivetime:    make(map[string]time.Time),
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

func WaitStreamTimeout(timeout time.Duration) CodecOption {
	return func(codec *Codec) {
		codec.waitStreamTimeout = timeout
	}
}

type Codec struct {
	// --- Configuration ---
	// Configurable options for method renaming, ID generation, and timeouts.
	clientMethodRenamer Renamer           // Renames Go RPC method names to JSON-RPC method names.
	serverMethodRenamer Renamer           // Renames JSON-RPC method names back to Go RPC format.
	jsonidGenerator     Generator[string] // Generates JSON-RPC request IDs.
	shutdownTimeout     time.Duration     // Graceful shutdown timeout (default 15s).
	waitStreamTimeout   time.Duration     // Stream idle wait timeout (default 30s).

	// --- Lifecycle control ---
	// Context and wait group for managing goroutine lifecycle.
	donectx context.Context    // Cancellation context to signal all goroutines to exit.
	cancel  context.CancelFunc // Cancel function for donectx.
	wg      sync.WaitGroup     // Tracks send() and recv() goroutines.

	// --- Underlying I/O ---
	// Low-level I/O components for reading and writing JSON-RPC messages.
	rwc io.ReadWriteCloser // Underlying read-write connection.
	enc *json.Encoder      // JSON encoder (used by send goroutine).
	dec *json.Decoder      // JSON decoder (used by recv goroutine).
	err atomic.Value       // Stores the first I/O error atomically.

	// --- Request flight counting ---
	// Tracks requests that have been decoded but not yet registered.
	// inflight counts decoded requests that have not yet been registered in srvreqids.
	// This closes a race window between recv() delivering a request and ReadRequestHeader()
	// adding it to srvreqids.
	inflight atomic.Int64

	// --- Server-side request handling ---
	// State for processing incoming requests on the server side.
	srvlock   sync.Mutex        // Mutex protecting server-side state.
	seq       uint64            // Server request sequence number.
	srvreqids map[uint64]string // Maps seq -> JSON-RPC ID.
	thisreq   Request           // Current request being processed.

	// --- Client-side request/response handling ---
	// State for processing outgoing requests and incoming responses on the client side.
	clilock     sync.Mutex        // Mutex protecting client-side state.
	clireqids   map[string]uint64 // Maps JSON-RPC ID -> seq.
	reqmeth     map[string]string // Maps JSON-RPC ID -> method name.
	thisres     Response          // Current response being processed.
	rxcloseonce sync.Once         // Ensures outpls is closed only once.

	// --- Output channel ---
	// Channel for outbound payloads to be sent.
	outpls      chan *Payload // Outbound payload channel.
	txcloseonce sync.Once     // Ensures inreqs/inress are closed only once.

	// --- Stream sender management ---
	// Manages streaming data senders.
	senderlock  sync.RWMutex                      // RWMutex protecting senders map.
	senders     map[string]<-chan json.RawMessage // Maps JSON-RPC ID -> send channel.
	senderwaker chan string                       // Wakes up the send() goroutine.

	// --- Stream receiver management ---
	// Manages streaming data receivers.
	receiverlock   sync.RWMutex                      // RWMutex protecting receivers map.
	receivers      map[string]chan<- json.RawMessage // Maps JSON-RPC ID -> receive channel.
	receiverwaker  chan string                       // Wakes up consumependings().
	receivercloser chan string                       // Actively closes a stream receiver.
	receivetime    map[string]time.Time              // Maps JSON-RPC ID -> last receive time.

	// --- Input channels ---
	// Channels for inbound requests and responses.
	inreqs chan Request  // Inbound request channel (recv -> ReadRequestHeader).
	inress chan Response // Inbound response channel (recv -> ReadResponseHeader).
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

func (c *Codec) watchidle(receiverid string) {
	closereceiver := func() {
		select {
		case c.receivercloser <- receiverid:
		case <-c.donectx.Done():
		}
	}
	timeout := c.waitStreamTimeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ticker := time.NewTicker(timeout)
	defer ticker.Stop()
	for {
		select {
		case tktime := <-ticker.C:
			c.receiverlock.RLock()
			receiver, ok := c.receivers[receiverid]
			c.receiverlock.RUnlock()
			if !ok {
				closereceiver()
				return
			}
			if receiver == nil {
				closereceiver()
				return
			} else {
				c.receiverlock.RLock()
				rctime := c.receivetime[receiverid]
				c.receiverlock.RUnlock()
				if tktime.Sub(rctime) > timeout {
					closereceiver()
					return
				}
			}
		case <-c.donectx.Done():
			return
		}
	}
}

func (c *Codec) send() {
	for {
		var payload *Payload
		select {
		case senderid := <-c.senderwaker:
			c.senderlock.RLock()
			sender, ok := c.senders[senderid]
			c.senderlock.RUnlock()
			if !ok {
				continue
			}
			select {
			case data, ok := <-sender:
				if !ok {
					c.senderlock.Lock()
					delete(c.senders, senderid)
					c.senderlock.Unlock()
					payload = &Payload{
						Version: JSONRPC2Version,
						ID:      senderid,
						Stream:  StreamClose,
					}
				} else {
					payload = &Payload{
						Version: JSONRPC2Version,
						ID:      senderid,
						Stream:  StreamSync,
						Data:    data,
					}
				}
			case <-c.donectx.Done():
				return
			}
		case out, ok := <-c.outpls:
			if !ok {
				return
			}
			payload = out
		}
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
	var (
		pendingstreams = list.New()
		pendinglock    sync.RWMutex
	)
	fdelement := func(id string) *list.Element {
		pendinglock.RLock()
		defer pendinglock.RUnlock()
		for element := pendingstreams.Front(); element != nil; element = element.Next() {
			payload := element.Value.(*Payload)
			if payload.ID == id {
				return element
			}
		}
		return nil
	}
	rmelement := func(element *list.Element) {
		pendinglock.Lock()
		defer pendinglock.Unlock()
		pendingstreams.Remove(element)
	}
	cleanup := func(id string) {
		pendinglock.Lock()
		defer pendinglock.Unlock()
		for element := pendingstreams.Front(); element != nil; {
			next := element.Next()
			payload := element.Value.(*Payload)
			if payload.ID == id {
				pendingstreams.Remove(element)
			}
			element = next
		}
	}
	enqueue := func(payload *Payload) {
		pendinglock.Lock()
		defer pendinglock.Unlock()
		pendingstreams.PushBack(payload)
	}
	requeue := func(receiverid string) {
		pendinglock.RLock()
		n := pendingstreams.Len()
		pendinglock.RUnlock()
		time.Sleep(time.Duration(max(n, 1)) * time.Second)
		select {
		case c.receiverwaker <- receiverid:
		case <-c.donectx.Done():
			return
		}
	}
	consumependings := func() {
		timeout := c.waitStreamTimeout
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		for {
			select {
			case receiverid := <-c.receiverwaker:
				element := fdelement(receiverid)
				if element == nil {
					go requeue(receiverid)
					continue
				}
				payload := element.Value.(*Payload)
				c.receiverlock.RLock()
				receiver, ok := c.receivers[payload.ID]
				c.receiverlock.RUnlock()
				if !ok {
					cleanup(receiverid)
					continue
				}
				if receiver == nil {
					panic("receiver is nil")
				}
				if payload.Stream == StreamClose {
					c.receiverlock.Lock()
					close(receiver)
					delete(c.receivers, payload.ID)
					delete(c.receivetime, payload.ID)
					c.receiverlock.Unlock()
				} else {
					select {
					case receiver <- payload.Data:
						c.receiverlock.Lock()
						c.receivetime[receiverid] = time.Now()
						c.receiverlock.Unlock()
					case <-time.After(timeout):
						go requeue(receiverid)
						continue
					case <-c.donectx.Done():
						return
					}
				}
				rmelement(element)
			case receiverid := <-c.receivercloser:
				c.receiverlock.Lock()
				receiver, ok := c.receivers[receiverid]
				if ok && receiver != nil {
					close(receiver)
				}
				delete(c.receivers, receiverid)
				delete(c.receivetime, receiverid)
				c.receiverlock.Unlock()
				cleanup(receiverid)
			case <-c.donectx.Done():
				return
			}
		}
	}
	go consumependings()
	for {
		var payload *Payload
		if err := c.dec.Decode(&payload); err != nil {
			c.cancel()
			c.err.CompareAndSwap(nil, &wraperror{err})
			return
		}
		if payload != nil {
			if payload.Stream > StreamOpen {
				c.receiverlock.RLock()
				_, ok := c.receivers[payload.ID]
				c.receiverlock.RUnlock()
				if ok {
					enqueue(payload)
				}
			} else {
				if payload.Stream == StreamOpen {
					c.receiverlock.Lock()
					c.receivers[payload.ID] = nil
					c.receiverlock.Unlock()
					go c.watchidle(payload.ID)
				}
				if payload.Method != "" {
					c.inflight.Add(1)
					select {
					case c.inreqs <- payload:
					case <-c.donectx.Done():
						c.inflight.Add(-1)
						return
					}
				} else {
					select {
					case c.inress <- payload:
					case <-c.donectx.Done():
						return
					}
				}
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
	reqid := c.thisreq.GetID()
	if receiver, ok := x.(StreamReceiver); ok {
		c.receiverlock.Lock()
		if c.thisreq.GetStream() == StreamOpen {
			c.receivers[reqid] = receiver.Receiver(
				func() {
					select {
					case c.receiverwaker <- reqid:
					case <-c.donectx.Done():
					}
				},
				func() {
					select {
					case c.receivercloser <- reqid:
					case <-c.donectx.Done():
					}
				},
			)
		} else {
			delete(c.receivers, reqid)
		}
		c.receiverlock.Unlock()
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
			sender, streamopen := x.(StreamSender)
			if streamopen {
				c.senderlock.Lock()
				c.senders[reqid] = sender.Sender(func() {
					select {
					case c.senderwaker <- reqid:
					case <-c.donectx.Done():
					}
				})
				c.senderlock.Unlock()
			}
			result, err := json.Marshal(x)
			if err != nil {
				return c.loadOrFallbackErr(err)
			}
			var stream int
			if streamopen {
				stream = StreamOpen
			}
			select {
			case c.outpls <- &Payload{
				Version: JSONRPC2Version,
				ID:      reqid,
				Stream:  stream,
				Result:  result,
			}:
			case <-c.donectx.Done():
				return c.loadOrFallbackErr(io.EOF)
			}
		} else {
			var errmsg json.RawMessage
			// NOTE: The net/rpc package does not export its internal error types,
			// so we have to match error strings to map them to JSON-RPC 2.0 error codes.
			if strings.HasPrefix(r.Error, "rpc: service/method request ill-formed: ") ||
				strings.HasPrefix(r.Error, "rpc: can't find service ") || strings.HasPrefix(r.Error, "rpc: can't find method ") {
				errmsg = json.RawMessage((Error{Code: ErrorCodeMethodNotFound, Message: r.Error}).Error())
			} else {
				errmsg = json.RawMessage(r.Error)
				if !json.Valid(errmsg) {
					// SAFETY: This is safe because we are marshalling a string to a json.RawMessage.
					errmsg, _ = json.Marshal(r.Error)
				}
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
	sender, streamopen := x.(StreamSender)
	if streamopen {
		c.senderlock.Lock()
		c.senders[reqid] = sender.Sender(func() {
			select {
			case c.senderwaker <- reqid:
			case <-c.donectx.Done():
			}
		})
		c.senderlock.Unlock()
	}
	var method string
	if renamer := c.clientMethodRenamer; renamer != nil {
		method = renamer.Rename(r.ServiceMethod)
	} else {
		method = r.ServiceMethod
	}
	var stream int
	if streamopen {
		stream = StreamOpen
	}
	select {
	case c.outpls <- &Payload{
		Version: JSONRPC2Version,
		Method:  method,
		ID:      reqid,
		Stream:  stream,
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
	resid := c.thisres.GetID()
	if receiver, ok := x.(StreamReceiver); ok {
		c.receiverlock.Lock()
		if c.thisres.GetStream() == StreamOpen {
			c.receivers[resid] = receiver.Receiver(
				func() {
					select {
					case c.receiverwaker <- resid:
					case <-c.donectx.Done():
					}
				},
				func() {
					select {
					case c.receivercloser <- resid:
					case <-c.donectx.Done():
					}
				},
			)
		} else {
			delete(c.receivers, resid)
		}
		c.receiverlock.Unlock()
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
	Stream  int             `json:"stream,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

func (p *Payload) GetID() string              { return p.ID }
func (p *Payload) GetMethod() string          { return p.Method }
func (p *Payload) GetStream() int             { return p.Stream }
func (p *Payload) GetData() json.RawMessage   { return p.Data }
func (p *Payload) GetParams() json.RawMessage { return p.Params }
func (p *Payload) GetResult() json.RawMessage { return p.Result }
func (p *Payload) GetError() json.RawMessage  { return p.Error }

type Request interface {
	GetID() string
	GetMethod() string
	GetStream() int
	GetParams() json.RawMessage
}

type Response interface {
	GetID() string
	GetStream() int
	GetResult() json.RawMessage
	GetError() json.RawMessage
}

type Stream interface {
	GetID() string
	GetStream() int
	GetData() json.RawMessage
}

type (
	Renamer              interface{ Rename(string) string }
	RenamerFunc          func(string) string
	Generator[T any]     interface{ Generate() T }
	GeneratorFunc[T any] func() T
)

func (f RenamerFunc) Rename(s string) string { return f(s) }
func (f GeneratorFunc[T]) Generate() T       { return f() }

const (
	StreamDisable = iota
	StreamOpen
	StreamSync
	StreamClose
)

type StreamSender interface {
	Sender(wake func()) <-chan json.RawMessage
}

type StreamReceiver interface {
	Receiver(wake func(), close func()) chan<- json.RawMessage
}
