package jsonrpc2

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/rpc"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

const testServiceName = "Transport"

func testClientRenamer(serviceMethod string) string {
	dot := strings.LastIndex(serviceMethod, ".")
	if dot >= 0 {
		return strings.ToLower(serviceMethod[dot+1:])
	}
	return strings.ToLower(serviceMethod)
}

func testServerRenamer(method string) string {
	return testServiceName + "." + cases.Title(language.English).String(method)
}

func newTestCodec(rwc io.ReadWriteCloser, options ...CodecOption) *Codec {
	seq := atomic.Uint64{}
	opts := []CodecOption{
		ClientMethodRenamer(RenamerFunc(testClientRenamer)),
		ServerMethodRenamer(RenamerFunc(testServerRenamer)),
		JSONIDGenerator(GeneratorFunc[string](func() string {
			return strconv.FormatUint(seq.Add(1), 10)
		})),
		ShutdownTimeout(200 * time.Millisecond),
	}
	opts = append(opts, options...)
	return NewCodec(rwc, opts...)
}

type TestArgs struct {
	UserInput string
}

type TestReply struct {
	Echo string
}

type testJSONErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e testJSONErr) Error() string {
	b, _ := json.Marshal(e)
	return string(b)
}

type TestWireService struct{}

func (TestWireService) Prompt(args *TestArgs, reply *TestReply) error {
	reply.Echo = args.UserInput
	return nil
}

func (TestWireService) Failplain(_ *struct{}, _ *struct{}) error {
	return errors.New("bad")
}

func (TestWireService) Failjson(_ *struct{}, _ *struct{}) error {
	return testJSONErr{Code: 123, Message: "bad"}
}

func startRPCServer(t *testing.T, codec *Codec, rcvr any) <-chan struct{} {
	t.Helper()

	srv := rpc.NewServer()
	if err := srv.RegisterName(testServiceName, rcvr); err != nil {
		t.Fatalf("RegisterName: %v", err)
	}

	done := make(chan struct{})
	go func() {
		srv.ServeCodec(codec)
		close(done)
	}()
	return done
}

func newRPCClient(t *testing.T, rcvr any) *rpc.Client {
	t.Helper()

	c1, c2 := net.Pipe()
	clientCodec := newTestCodec(c1)
	serverCodec := newTestCodec(c2)
	done := startRPCServer(t, serverCodec, rcvr)

	client := rpc.NewClientWithCodec(clientCodec)
	t.Cleanup(func() {
		_ = client.Close()
		select {
		case <-done:
		case <-time.After(1 * time.Second):
			t.Fatalf("rpc server did not exit")
		}
	})
	return client
}

func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(1 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for condition")
}

type failWriter struct {
	err error
}

func (w failWriter) Write(p []byte) (int, error) {
	return 0, w.err
}

type pipeRWC struct {
	r *io.PipeReader
	w io.Writer
}

func (p *pipeRWC) Read(b []byte) (int, error) {
	return p.r.Read(b)
}

func (p *pipeRWC) Write(b []byte) (int, error) {
	return p.w.Write(b)
}

func (p *pipeRWC) Close() error {
	_ = p.r.Close()
	if c, ok := p.w.(io.Closer); ok {
		_ = c.Close()
	}
	return nil
}

func TestCodec_RPC_RoundTrip_Success(t *testing.T) {
	client := newRPCClient(t, TestWireService{})

	var reply TestReply
	if err := client.Call("Transport.Prompt", &TestArgs{UserInput: "hello"}, &reply); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if reply.Echo != "hello" {
		t.Fatalf("unexpected reply: %+v", reply)
	}
}

func TestCodec_RPC_Error_PlainStringIsJSONEncodedString(t *testing.T) {
	client := newRPCClient(t, TestWireService{})

	err := client.Call("Transport.Failplain", &struct{}{}, &struct{}{})
	if err == nil {
		t.Fatalf("expected error")
	}
	if got, want := err.Error(), "\"bad\""; got != want {
		t.Fatalf("unexpected error string: got %q want %q", got, want)
	}
}

func TestCodec_RPC_Error_JSONObject_PreservedAndParseable(t *testing.T) {
	client := newRPCClient(t, TestWireService{})

	err := client.Call("Transport.Failjson", &struct{}{}, &struct{}{})
	if err == nil {
		t.Fatalf("expected error")
	}

	parsed, ok := ParseServerError[testJSONErr](err)
	if !ok {
		t.Fatalf("expected ParseServerError ok=true, err=%v", err)
	}
	if parsed.Code != 123 || parsed.Message != "bad" {
		t.Fatalf("unexpected parsed error: %+v", parsed)
	}
}

func TestCodec_Notification_NoID_NoResponse(t *testing.T) {
	serverConn, peerConn := net.Pipe()
	serverCodec := newTestCodec(serverConn)
	done := startRPCServer(t, serverCodec, TestWireService{})

	enc := json.NewEncoder(peerConn)
	params, err := json.Marshal(&TestArgs{UserInput: "hello"})
	if err != nil {
		t.Fatalf("Marshal params: %v", err)
	}

	req := map[string]any{
		"jsonrpc": JSONRPC2Version,
		"method":  "prompt",
		"params":  json.RawMessage(params),
	}
	if err := enc.Encode(req); err != nil {
		t.Fatalf("Encode request: %v", err)
	}

	_ = peerConn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	dec := json.NewDecoder(peerConn)
	var resp Payload
	derr := dec.Decode(&resp)
	if derr == nil {
		t.Fatalf("expected no response, got: %+v", resp)
	}
	if ne, ok := derr.(net.Error); !ok || !ne.Timeout() {
		t.Fatalf("expected timeout, got: %T %v", derr, derr)
	}

	_ = peerConn.Close()
	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Fatalf("rpc server did not exit")
	}
}

func TestCodec_EOF_AfterClose_ReturnsBareEOF(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	_ = c2.Close()
	_ = codec.Close()

	if err := codec.ReadRequestHeader(&rpc.Request{}); err != io.EOF {
		t.Fatalf("ReadRequestHeader: got %T %v want io.EOF", err, err)
	}
	if err := codec.ReadResponseHeader(&rpc.Response{}); err != io.EOF {
		t.Fatalf("ReadResponseHeader: got %T %v want io.EOF", err, err)
	}
}

func TestCodec_EOF_RemoteClose_ReadRequestHeaderReturnsEOF(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	_ = c2.Close()
	defer codec.Close()

	ch := make(chan error, 1)
	go func() {
		ch <- codec.ReadRequestHeader(&rpc.Request{})
	}()

	select {
	case err := <-ch:
		if err != io.EOF {
			t.Fatalf("got %T %v want io.EOF", err, err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("ReadRequestHeader did not return")
	}
}

func TestCodec_ReadResponseHeader_KnownID_CleansMaps(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	codec.clilock.Lock()
	codec.reqmeth["rid"] = "Transport.Prompt"
	codec.clireqids["rid"] = 42
	codec.clilock.Unlock()

	_, _ = io.WriteString(c2, "{\"jsonrpc\":\"2.0\",\"id\":\"rid\",\"result\":{}}\n")

	var r rpc.Response
	if err := codec.ReadResponseHeader(&r); err != nil {
		t.Fatalf("ReadResponseHeader: %v", err)
	}
	if r.ServiceMethod != "Transport.Prompt" {
		t.Fatalf("unexpected ServiceMethod: %q", r.ServiceMethod)
	}
	if r.Seq != 42 {
		t.Fatalf("unexpected Seq: %d", r.Seq)
	}

	codec.clilock.Lock()
	_, okMeth := codec.reqmeth["rid"]
	_, okSeq := codec.clireqids["rid"]
	codec.clilock.Unlock()
	if okMeth || okSeq {
		t.Fatalf("expected reqmeth/clireqids entries to be deleted")
	}
}

func TestCodec_DecodeError_InvalidJSON_PropagatesNonEOF(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	_, _ = io.WriteString(c2, "}\n")

	waitUntil(t, 1*time.Second, func() bool {
		return codec.err.Load() != nil
	})

	err := codec.ReadRequestHeader(&rpc.Request{})
	if err == nil {
		t.Fatalf("expected error")
	}
	if err == io.EOF {
		t.Fatalf("expected non-EOF error, got io.EOF")
	}

	var syntaxErr *json.SyntaxError
	if !errors.As(err, &syntaxErr) {
		t.Fatalf("expected json syntax error, got %T %v", err, err)
	}
}

func TestCodec_RPC_UnknownMethod_DiscardBodyAndError(t *testing.T) {
	client := newRPCClient(t, TestWireService{})

	err := client.Call("Transport.Unknown", &TestArgs{UserInput: "x"}, &TestReply{})
	if err == nil {
		t.Fatalf("expected error")
	}
	if !strings.Contains(err.Error(), "can't find method") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCodec_RPC_UnknownMethod_ReturnsMethodNotFoundError(t *testing.T) {
	client := newRPCClient(t, TestWireService{})

	err := client.Call("Transport.Unknown", &TestArgs{UserInput: "x"}, &TestReply{})
	if err == nil {
		t.Fatalf("expected error")
	}

	parsed, ok := ParseError(err)
	if !ok {
		t.Fatalf("expected ParseError ok=true, err=%v", err)
	}
	if parsed.Code != ErrorCodeMethodNotFound {
		t.Fatalf("expected error code %d, got %d", ErrorCodeMethodNotFound, parsed.Code)
	}
	if !strings.Contains(parsed.Message, "can't find method") {
		t.Fatalf("unexpected error message: %q", parsed.Message)
	}
}

func TestCodec_RPC_UnknownService_ReturnsMethodNotFoundError(t *testing.T) {
	serverConn, peerConn := net.Pipe()
	// Use codec without renamer so method names are passed through as-is.
	serverCodec := NewCodec(serverConn, ShutdownTimeout(200*time.Millisecond))

	srv := rpc.NewServer()
	if err := srv.RegisterName(testServiceName, TestWireService{}); err != nil {
		t.Fatalf("RegisterName: %v", err)
	}
	done := make(chan struct{})
	go func() {
		srv.ServeCodec(serverCodec)
		close(done)
	}()

	enc := json.NewEncoder(peerConn)
	dec := json.NewDecoder(peerConn)

	// Send request with unknown service name.
	params, _ := json.Marshal(&TestArgs{UserInput: "x"})
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Method:  "Unknown.Prompt", // Unknown service
		Params:  params,
	}); err != nil {
		t.Fatalf("Encode request: %v", err)
	}

	var resp Payload
	if err := dec.Decode(&resp); err != nil {
		t.Fatalf("Decode response: %v", err)
	}

	var parsed Error
	if err := json.Unmarshal(resp.Error, &parsed); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	if parsed.Code != ErrorCodeMethodNotFound {
		t.Fatalf("expected error code %d, got %d", ErrorCodeMethodNotFound, parsed.Code)
	}
	if !strings.Contains(parsed.Message, "can't find service") {
		t.Fatalf("unexpected error message: %q", parsed.Message)
	}

	_ = peerConn.Close()
	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Fatalf("rpc server did not exit")
	}
}

func TestCodec_RPC_IllFormedMethod_ReturnsMethodNotFoundError(t *testing.T) {
	serverConn, peerConn := net.Pipe()
	// Use codec without renamer so method names are passed through as-is.
	serverCodec := NewCodec(serverConn, ShutdownTimeout(200*time.Millisecond))

	srv := rpc.NewServer()
	if err := srv.RegisterName(testServiceName, TestWireService{}); err != nil {
		t.Fatalf("RegisterName: %v", err)
	}
	done := make(chan struct{})
	go func() {
		srv.ServeCodec(serverCodec)
		close(done)
	}()

	enc := json.NewEncoder(peerConn)
	dec := json.NewDecoder(peerConn)

	// Send request with ill-formed method name (no dot).
	params, _ := json.Marshal(&TestArgs{UserInput: "x"})
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Method:  "nodot", // Ill-formed: no dot separator
		Params:  params,
	}); err != nil {
		t.Fatalf("Encode request: %v", err)
	}

	var resp Payload
	if err := dec.Decode(&resp); err != nil {
		t.Fatalf("Decode response: %v", err)
	}

	var parsed Error
	if err := json.Unmarshal(resp.Error, &parsed); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	if parsed.Code != ErrorCodeMethodNotFound {
		t.Fatalf("expected error code %d, got %d", ErrorCodeMethodNotFound, parsed.Code)
	}
	if !strings.Contains(parsed.Message, "ill-formed") {
		t.Fatalf("unexpected error message: %q", parsed.Message)
	}

	_ = peerConn.Close()
	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Fatalf("rpc server did not exit")
	}
}

func TestParseServerError_EdgeCases(t *testing.T) {
	if _, ok := ParseServerError[testJSONErr](nil); ok {
		t.Fatalf("expected ok=false for nil error")
	}
	if _, ok := ParseServerError[testJSONErr](errors.New("x")); ok {
		t.Fatalf("expected ok=false for non-ServerError")
	}
	if _, ok := ParseServerError[testJSONErr](rpc.ServerError("not json")); ok {
		t.Fatalf("expected ok=false for invalid JSON")
	}
}

func TestCodec_WriteRequest_MarshalError_ReturnsUnsupportedTypeError(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer c2.Close()
	defer codec.Close()

	err := codec.WriteRequest(&rpc.Request{ServiceMethod: "Transport.Prompt", Seq: 1}, func() {})
	if err == nil {
		t.Fatalf("expected error")
	}
	var ute *json.UnsupportedTypeError
	if !errors.As(err, &ute) {
		t.Fatalf("expected *json.UnsupportedTypeError, got %T %v", err, err)
	}

	codec.clilock.Lock()
	pending := len(codec.reqmeth) + len(codec.clireqids)
	codec.clilock.Unlock()
	if pending != 0 {
		t.Fatalf("expected no pending mappings after marshal error")
	}
}

func TestCodec_WriteResponse_MarshalError_ReturnsUnsupportedTypeErrorAndCleansReqid(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer c2.Close()
	defer codec.Close()

	codec.srvlock.Lock()
	codec.srvreqids[1] = "1"
	codec.srvlock.Unlock()

	err := codec.WriteResponse(&rpc.Response{Seq: 1}, func() {})
	if err == nil {
		t.Fatalf("expected error")
	}
	var ute *json.UnsupportedTypeError
	if !errors.As(err, &ute) {
		t.Fatalf("expected *json.UnsupportedTypeError, got %T %v", err, err)
	}

	codec.srvlock.Lock()
	_, ok := codec.srvreqids[1]
	codec.srvlock.Unlock()
	if ok {
		t.Fatalf("expected reqids entry to be deleted")
	}
}

func TestCodec_Send_EncodeError_SetsErrAndSubsequentCallsFail(t *testing.T) {
	writeErr := errors.New("write fail")
	pr, pw := io.Pipe()
	codec := newTestCodec(&pipeRWC{r: pr, w: failWriter{err: writeErr}})
	defer codec.Close()
	defer pw.Close()

	err := codec.WriteRequest(&rpc.Request{ServiceMethod: "Transport.Prompt", Seq: 1}, &TestArgs{UserInput: "x"})
	if err != nil {
		t.Fatalf("WriteRequest: %v", err)
	}

	waitUntil(t, 1*time.Second, func() bool {
		return codec.err.Load() != nil
	})

	err = codec.WriteRequest(&rpc.Request{ServiceMethod: "Transport.Prompt", Seq: 2}, &TestArgs{UserInput: "y"})
	if err == nil {
		t.Fatalf("expected error")
	}
	if errors.Is(err, io.EOF) {
		t.Fatalf("expected non-EOF error, got %T %v", err, err)
	}
	if !errors.Is(err, writeErr) {
		t.Fatalf("expected write error, got %T %v", err, err)
	}

	codec.clilock.Lock()
	delete(codec.reqmeth, "1")
	delete(codec.clireqids, "1")
	codec.clilock.Unlock()
}

func TestCodec_ShutdownTimeout_CustomValue(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c2.Close()

	customTimeout := 100 * time.Millisecond
	codec := NewCodec(c1, ShutdownTimeout(customTimeout))

	if codec.shutdownTimeout != customTimeout {
		t.Fatalf("expected shutdownTimeout=%v, got %v", customTimeout, codec.shutdownTimeout)
	}

	start := time.Now()
	_ = codec.Close()
	elapsed := time.Since(start)

	if elapsed > 200*time.Millisecond {
		t.Fatalf("Close took too long: %v, expected < 200ms with custom timeout", elapsed)
	}
}

func TestCodec_ShutdownTimeout_DefaultValue(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c2.Close()

	codec := NewCodec(c1)

	if codec.shutdownTimeout != 0 {
		t.Fatalf("expected shutdownTimeout=0 (unset), got %v", codec.shutdownTimeout)
	}

	start := time.Now()
	_ = codec.Close()
	elapsed := time.Since(start)

	if elapsed > 200*time.Millisecond {
		t.Fatalf("Close took too long: %v, expected quick close with no pending requests", elapsed)
	}
}

func TestCodec_PendingRequests_IncludesInflightServerRequest(t *testing.T) {
	c1, c2 := net.Pipe()
	started := make(chan struct{})
	release := make(chan struct{})

	codec := NewCodec(
		c1,
		ServerMethodRenamer(RenamerFunc(func(method string) string {
			// Block ReadRequestHeader right after it has received the request,
			// but before it registers the request into srvreqids.
			//
			// This reproduces the "pending == 0" blind spot that can cause callers
			// to incorrectly assume there is no more data exchange.
			close(started)
			<-release
			return method
		})),
	)
	defer codec.Close()
	defer c2.Close()

	// Drain responses written by codec to avoid blocking its send goroutine.
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		dec := json.NewDecoder(c2)
		for {
			var p Payload
			if err := dec.Decode(&p); err != nil {
				return
			}
		}
	}()

	hdr := make(chan rpc.Request, 1)
	hdrErr := make(chan error, 1)
	go func() {
		var r rpc.Request
		if err := codec.ReadRequestHeader(&r); err != nil {
			hdrErr <- err
			return
		}
		hdr <- r
	}()

	params, err := json.Marshal(map[string]any{"x": 1})
	if err != nil {
		t.Fatalf("Marshal params: %v", err)
	}
	enc := json.NewEncoder(c2)
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "req-1",
		Method:  "event",
		Params:  params,
	}); err != nil {
		t.Fatalf("Encode request: %v", err)
	}

	select {
	case <-started:
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for serverMethodRenamer to run")
	}

	if got := codec.PendingRequests(); got != 1 {
		t.Fatalf("expected PendingRequests=1 while request is in-flight, got %d", got)
	}

	close(release)

	var req rpc.Request
	select {
	case req = <-hdr:
	case err := <-hdrErr:
		t.Fatalf("ReadRequestHeader: %v", err)
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for ReadRequestHeader to return")
	}

	if err := codec.ReadRequestBody(nil); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}
	if err := codec.WriteResponse(&rpc.Response{Seq: req.Seq}, &struct{}{}); err != nil {
		t.Fatalf("WriteResponse: %v", err)
	}

	waitUntil(t, 1*time.Second, func() bool {
		return codec.PendingRequests() == 0
	})

	_ = c2.Close()
	select {
	case <-drained:
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for drain goroutine to exit")
	}
}

type testStreamSender struct {
	ch   chan json.RawMessage
	wake func()
}

func newTestStreamSender() *testStreamSender {
	return &testStreamSender{ch: make(chan json.RawMessage, 16)}
}

func (s *testStreamSender) Sender(wake func()) <-chan json.RawMessage {
	s.wake = wake
	return s.ch
}

func (s *testStreamSender) Send(data json.RawMessage) {
	s.ch <- data
	s.wake()
}

func (s *testStreamSender) Close() {
	close(s.ch)
	s.wake()
}

func (s *testStreamSender) Wake() {
	s.wake()
}

type testStreamReceiver struct {
	ch    chan json.RawMessage
	wake  func()
	close func()
}

func newTestStreamReceiver(buf int) *testStreamReceiver {
	return &testStreamReceiver{ch: make(chan json.RawMessage, buf)}
}

func (r *testStreamReceiver) Receiver(wake func(), close func()) chan<- json.RawMessage {
	r.wake = wake
	r.close = close
	return r.ch
}

func (r *testStreamReceiver) Wake() {
	r.wake()
}

func (r *testStreamReceiver) Close() {
	r.close()
}

func TestCodec_StreamSender_WriteRequest_SendsOpenAndCloseFrames(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	dec := json.NewDecoder(c2)

	sender := newTestStreamSender()
	if err := codec.WriteRequest(&rpc.Request{ServiceMethod: "Transport.Prompt", Seq: 1}, sender); err != nil {
		t.Fatalf("WriteRequest: %v", err)
	}

	var req Payload
	if err := dec.Decode(&req); err != nil {
		t.Fatalf("Decode request: %v", err)
	}
	if req.Method != "prompt" {
		t.Fatalf("unexpected request method: %q", req.Method)
	}
	if req.ID != "1" {
		t.Fatalf("unexpected request id: %q", req.ID)
	}
	if req.Stream != StreamOpen {
		t.Fatalf("unexpected request stream: %d", req.Stream)
	}
	if got, want := string(req.Params), "{}"; got != want {
		t.Fatalf("unexpected request params: got %q want %q", got, want)
	}

	sender.Send(json.RawMessage(`"one"`))
	var p1 Payload
	if err := dec.Decode(&p1); err != nil {
		t.Fatalf("Decode stream open 1: %v", err)
	}
	if p1.ID != "1" || p1.Stream != StreamSync {
		t.Fatalf("unexpected stream sync 1: %+v", p1)
	}
	if got, want := string(p1.Data), `"one"`; got != want {
		t.Fatalf("unexpected stream data 1: got %q want %q", got, want)
	}

	sender.Send(json.RawMessage(`"two"`))
	var p2 Payload
	if err := dec.Decode(&p2); err != nil {
		t.Fatalf("Decode stream open 2: %v", err)
	}
	if p2.ID != "1" || p2.Stream != StreamSync {
		t.Fatalf("unexpected stream sync 2: %+v", p2)
	}
	if got, want := string(p2.Data), `"two"`; got != want {
		t.Fatalf("unexpected stream data 2: got %q want %q", got, want)
	}

	sender.Close()
	var eof Payload
	if err := dec.Decode(&eof); err != nil {
		t.Fatalf("Decode stream close: %v", err)
	}
	if eof.ID != "1" || eof.Stream != StreamClose {
		t.Fatalf("unexpected stream close: %+v", eof)
	}

	// Wake after the sender is removed should not emit any payload.
	sender.Wake()
	_ = c2.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var extra Payload
	err := dec.Decode(&extra)
	if err == nil {
		t.Fatalf("expected no extra payload, got: %+v", extra)
	}
	if ne, ok := err.(net.Error); !ok || !ne.Timeout() {
		t.Fatalf("expected timeout, got: %T %v", err, err)
	}
}

func TestCodec_StreamSender_WriteResponse_SendsOpenAndCloseFrames(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	codec.srvlock.Lock()
	codec.srvreqids[42] = "rid"
	codec.srvlock.Unlock()

	dec := json.NewDecoder(c2)

	sender := newTestStreamSender()
	if err := codec.WriteResponse(&rpc.Response{Seq: 42}, sender); err != nil {
		t.Fatalf("WriteResponse: %v", err)
	}

	var resp Payload
	if err := dec.Decode(&resp); err != nil {
		t.Fatalf("Decode response: %v", err)
	}
	if resp.ID != "rid" || resp.Stream != StreamOpen {
		t.Fatalf("unexpected response payload: %+v", resp)
	}
	if got, want := string(resp.Result), "{}"; got != want {
		t.Fatalf("unexpected response result: got %q want %q", got, want)
	}

	sender.Send(json.RawMessage(`"x"`))
	var p1 Payload
	if err := dec.Decode(&p1); err != nil {
		t.Fatalf("Decode stream open: %v", err)
	}
	if p1.ID != "rid" || p1.Stream != StreamSync {
		t.Fatalf("unexpected stream sync: %+v", p1)
	}
	if got, want := string(p1.Data), `"x"`; got != want {
		t.Fatalf("unexpected stream data: got %q want %q", got, want)
	}

	sender.Close()
	var eof Payload
	if err := dec.Decode(&eof); err != nil {
		t.Fatalf("Decode stream close: %v", err)
	}
	if eof.ID != "rid" || eof.Stream != StreamClose {
		t.Fatalf("unexpected stream close: %+v", eof)
	}
}

func TestCodec_StreamReceiver_Request_EarlyFramesDeliveredAfterRegisterAndWake(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	enc := json.NewEncoder(c2)

	encodeReqErr := make(chan error, 1)
	go func() {
		encodeReqErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "1",
			Method:  "prompt",
			Stream:  StreamOpen,
			Params:  json.RawMessage("{}"),
		})
	}()

	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-encodeReqErr:
		if err != nil {
			t.Fatalf("Encode request: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode request")
	}
	if req.ServiceMethod != "Transport.Prompt" {
		t.Fatalf("unexpected ServiceMethod: %q", req.ServiceMethod)
	}

	// Stream frames arrive before receiver is registered (ReadRequestBody).
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"hello"`),
	}); err != nil {
		t.Fatalf("Encode stream open: %v", err)
	}
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamClose,
	}); err != nil {
		t.Fatalf("Encode stream close: %v", err)
	}

	receiver := newTestStreamReceiver(1)
	if err := codec.ReadRequestBody(receiver); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}

	receiver.Wake()
	select {
	case got := <-receiver.ch:
		if string(got) != `"hello"` {
			t.Fatalf("unexpected stream data: %q", string(got))
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for stream data")
	}

	receiver.Wake()
	select {
	case _, ok := <-receiver.ch:
		if ok {
			t.Fatalf("expected receiver channel to be closed")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for receiver channel close")
	}

	codec.receiverlock.RLock()
	_, ok := codec.receivers["1"]
	codec.receiverlock.RUnlock()
	if ok {
		t.Fatalf("expected receiver to be removed")
	}
}

func TestCodec_StreamReceiver_Request_WakeBeforeFrame_RequeueEventuallyDelivers(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	enc := json.NewEncoder(c2)

	encodeReqErr := make(chan error, 1)
	go func() {
		encodeReqErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "1",
			Method:  "prompt",
			Stream:  StreamOpen,
			Params:  json.RawMessage("{}"),
		})
	}()

	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-encodeReqErr:
		if err != nil {
			t.Fatalf("Encode request: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode request")
	}

	receiver := newTestStreamReceiver(1)
	if err := codec.ReadRequestBody(receiver); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}

	// Wake before any stream frame arrives.
	receiver.Wake()

	time.Sleep(100 * time.Millisecond)
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"late"`),
	}); err != nil {
		t.Fatalf("Encode stream open: %v", err)
	}
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamClose,
	}); err != nil {
		t.Fatalf("Encode stream close: %v", err)
	}

	select {
	case got := <-receiver.ch:
		if string(got) != `"late"` {
			t.Fatalf("unexpected stream data: %q", string(got))
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timeout waiting for requeue delivery")
	}

	receiver.Wake()
	select {
	case _, ok := <-receiver.ch:
		if ok {
			t.Fatalf("expected receiver channel to be closed")
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for receiver channel close")
	}
}

func TestCodec_StreamReceiver_Response_EarlyFramesDeliveredAfterRegisterAndWake(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	codec.clilock.Lock()
	codec.reqmeth["rid"] = "Transport.Prompt"
	codec.clireqids["rid"] = 42
	codec.clilock.Unlock()

	enc := json.NewEncoder(c2)

	encodeRespErr := make(chan error, 1)
	go func() {
		encodeRespErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "rid",
			Stream:  StreamOpen,
			Result:  json.RawMessage("{}"),
		})
	}()

	var r rpc.Response
	if err := codec.ReadResponseHeader(&r); err != nil {
		t.Fatalf("ReadResponseHeader: %v", err)
	}

	select {
	case err := <-encodeRespErr:
		if err != nil {
			t.Fatalf("Encode response: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode response")
	}
	if r.ServiceMethod != "Transport.Prompt" || r.Seq != 42 {
		t.Fatalf("unexpected response header: %+v", r)
	}

	// Stream frames arrive before receiver is registered (ReadResponseBody).
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "rid",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"r1"`),
	}); err != nil {
		t.Fatalf("Encode stream open: %v", err)
	}
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "rid",
		Stream:  StreamClose,
	}); err != nil {
		t.Fatalf("Encode stream close: %v", err)
	}

	receiver := newTestStreamReceiver(1)
	if err := codec.ReadResponseBody(receiver); err != nil {
		t.Fatalf("ReadResponseBody: %v", err)
	}

	receiver.Wake()
	select {
	case got := <-receiver.ch:
		if string(got) != `"r1"` {
			t.Fatalf("unexpected stream data: %q", string(got))
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for stream data")
	}

	receiver.Wake()
	select {
	case _, ok := <-receiver.ch:
		if ok {
			t.Fatalf("expected receiver channel to be closed")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for receiver channel close")
	}
}

func TestCodec_Stream_WaitStreamTimeout_UnregisteredReceiver_DropsPending(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1, WaitStreamTimeout(200*time.Millisecond))
	defer codec.Close()
	defer c2.Close()

	enc := json.NewEncoder(c2)

	encodeReqErr := make(chan error, 1)
	go func() {
		encodeReqErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "1",
			Method:  "prompt",
			Stream:  StreamOpen,
			Params:  json.RawMessage("{}"),
		})
	}()

	// Drain the request, but do not register a StreamReceiver.
	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-encodeReqErr:
		if err != nil {
			t.Fatalf("Encode request: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode request")
	}
	if err := codec.ReadRequestBody(nil); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}

	// Enqueue some stream frames while the receiver is still only a nil placeholder.
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"x"`),
	}); err != nil {
		t.Fatalf("Encode stream sync: %v", err)
	}
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"y"`),
	}); err != nil {
		t.Fatalf("Encode stream sync: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		codec.receiverlock.RLock()
		_, ok := codec.receivers["1"]
		codec.receiverlock.RUnlock()
		return !ok
	})
}

func TestCodec_Stream_NullPayload_IsIgnored(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	writeErr := make(chan error, 1)
	go func() {
		if _, err := io.WriteString(c2, "null\n"); err != nil {
			writeErr <- err
			return
		}
		if _, err := io.WriteString(c2, "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"prompt\",\"params\":{}}\n"); err != nil {
			writeErr <- err
			return
		}
		writeErr <- nil
	}()

	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-writeErr:
		if err != nil {
			t.Fatalf("WriteString: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for peer writes")
	}

	if req.ServiceMethod != "Transport.Prompt" {
		t.Fatalf("unexpected ServiceMethod: %q", req.ServiceMethod)
	}
}

func TestCodec_StreamReceiver_Close_ProactivelyClosesStream(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	enc := json.NewEncoder(c2)

	// Send a stream-enabled request.
	encodeReqErr := make(chan error, 1)
	go func() {
		encodeReqErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "1",
			Method:  "prompt",
			Stream:  StreamOpen,
			Params:  json.RawMessage("{}"),
		})
	}()

	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-encodeReqErr:
		if err != nil {
			t.Fatalf("Encode request: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode request")
	}

	// Register the receiver.
	receiver := newTestStreamReceiver(1)
	if err := codec.ReadRequestBody(receiver); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}

	// Verify receiver is registered.
	codec.receiverlock.RLock()
	_, ok := codec.receivers["1"]
	codec.receiverlock.RUnlock()
	if !ok {
		t.Fatalf("expected receiver to be registered")
	}

	// Send a stream frame.
	if err := enc.Encode(Payload{
		Version: JSONRPC2Version,
		ID:      "1",
		Stream:  StreamSync,
		Data:    json.RawMessage(`"data1"`),
	}); err != nil {
		t.Fatalf("Encode stream sync: %v", err)
	}

	// Proactively close the stream from receiver side.
	receiver.Close()

	// Verify receiver channel is closed and resources are cleaned up.
	waitUntil(t, 2*time.Second, func() bool {
		codec.receiverlock.RLock()
		_, exists := codec.receivers["1"]
		codec.receiverlock.RUnlock()
		return !exists
	})

	// Verify the receiver channel is closed.
	select {
	case _, ok := <-receiver.ch:
		if ok {
			t.Fatalf("expected receiver channel to be closed")
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for receiver channel close")
	}
}

func TestCodec_StreamReceiver_Close_Idempotent(t *testing.T) {
	c1, c2 := net.Pipe()
	codec := newTestCodec(c1)
	defer codec.Close()
	defer c2.Close()

	enc := json.NewEncoder(c2)

	// Send a stream-enabled request.
	encodeReqErr := make(chan error, 1)
	go func() {
		encodeReqErr <- enc.Encode(Payload{
			Version: JSONRPC2Version,
			ID:      "1",
			Method:  "prompt",
			Stream:  StreamOpen,
			Params:  json.RawMessage("{}"),
		})
	}()

	var req rpc.Request
	if err := codec.ReadRequestHeader(&req); err != nil {
		t.Fatalf("ReadRequestHeader: %v", err)
	}

	select {
	case err := <-encodeReqErr:
		if err != nil {
			t.Fatalf("Encode request: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timeout waiting for Encode request")
	}

	receiver := newTestStreamReceiver(1)
	if err := codec.ReadRequestBody(receiver); err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}

	// Call close multiple times - should not panic.
	receiver.Close()
	receiver.Close()
	receiver.Close()

	// Verify cleanup happened.
	waitUntil(t, 2*time.Second, func() bool {
		codec.receiverlock.RLock()
		_, exists := codec.receivers["1"]
		codec.receiverlock.RUnlock()
		return !exists
	})
}
