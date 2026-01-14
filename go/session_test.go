package kimi

import (
	"io"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func TestResponder_Event(t *testing.T) {
	msgs := make(chan wire.Message, 1)
	usrc := make(chan wire.RequestResponse, 1)

	var rwlock sync.RWMutex
	responder := &Responder{rwlock: &rwlock, pending: new(atomic.Int64), wireMessageBridge: &msgs, wireRequestResponseChan: &usrc}

	event := &wire.EventParams{
		Type: wire.EventTypeContentPart,
		Payload: wire.ContentPart{
			Type: wire.ContentPartTypeText,
			Text: "hello",
		},
	}

	result, err := responder.Event(event)
	if err != nil {
		t.Fatalf("Event: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	select {
	case msg := <-msgs:
		cp, ok := msg.(wire.ContentPart)
		if !ok {
			t.Fatalf("expected ContentPart, got %T", msg)
		}
		if cp.Text != "hello" {
			t.Errorf("expected text 'hello', got %s", cp.Text)
		}
	default:
		t.Fatal("expected message in channel")
	}
}

func TestResponder_Event_NilMsgs(t *testing.T) {
	var msgs chan wire.Message
	usrc := make(chan wire.RequestResponse, 1)
	var rwlock sync.RWMutex
	responder := &Responder{rwlock: &rwlock, pending: new(atomic.Int64), wireMessageBridge: &msgs, wireRequestResponseChan: &usrc}

	event := &wire.EventParams{
		Type: wire.EventTypeContentPart,
		Payload: wire.ContentPart{
			Type: wire.ContentPartTypeText,
			Text: "hello",
		},
	}

	result, err := responder.Event(event)
	if err != nil {
		t.Fatalf("Event: %v", err)
	}
	// Should return empty result when msgs is nil
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestResponder_Request_ApprovalRequest(t *testing.T) {
	msgs := make(chan wire.Message, 1)
	usrc := make(chan wire.RequestResponse, 1)

	var rwlock sync.RWMutex
	responder := &Responder{rwlock: &rwlock, pending: new(atomic.Int64), wireMessageBridge: &msgs, wireRequestResponseChan: &usrc}

	approvalRequest := wire.ApprovalRequest{
		ID:          "req-123",
		ToolCallID:  "tool-456",
		Sender:      "agent",
		Action:      "execute",
		Description: "Run command",
	}

	request := &wire.RequestParams{
		Type:    wire.RequestTypeApprovalRequest,
		Payload: approvalRequest,
	}

	// Run in goroutine since it blocks waiting for response
	done := make(chan struct{})
	var result *wire.RequestResult
	var err error
	go func() {
		result, err = responder.Request(request)
		close(done)
	}()

	// Receive the message and respond (with timeout)
	select {
	case msg := <-msgs:
		ar, ok := msg.(wire.ApprovalRequest)
		if !ok {
			t.Fatalf("expected ApprovalRequest, got %T", msg)
		}
		if ar.ID != "req-123" {
			t.Errorf("expected ID 'req-123', got %s", ar.ID)
		}
		// Respond with approve
		ar.Respond(wire.ApprovalRequestResponseApprove)
	case <-done:
		t.Fatal("request completed before message was received")
	}

	// Wait for result
	<-done

	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	if result.RequestID != "req-123" {
		t.Errorf("expected request_id 'req-123', got %s", result.RequestID)
	}
	if result.Response != wire.ApprovalRequestResponseApprove {
		t.Errorf("expected response 'approve', got %s", result.Response)
	}
}

func TestResponder_Request_NilMsgs(t *testing.T) {
	var msgs chan wire.Message
	usrc := make(chan wire.RequestResponse, 1)
	var rwlock sync.RWMutex
	responder := &Responder{rwlock: &rwlock, pending: new(atomic.Int64), wireMessageBridge: &msgs, wireRequestResponseChan: &usrc}

	approvalRequest := wire.ApprovalRequest{
		ID:          "req-123",
		ToolCallID:  "tool-456",
		Sender:      "agent",
		Action:      "execute",
		Description: "Run command",
	}

	request := &wire.RequestParams{
		Type:    wire.RequestTypeApprovalRequest,
		Payload: approvalRequest,
	}

	_, err := responder.Request(request)
	// Should return error when wireMessageBridge is nil
	if err == nil {
		t.Fatal("expected error when wireMessageBridge is nil, got nil")
	}
}

func TestResponderFunc(t *testing.T) {
	var called bool
	var receivedResponse wire.RequestResponse

	f := ResponderFunc(func(rr wire.RequestResponse) error {
		called = true
		receivedResponse = rr
		return nil
	})

	err := f.Respond(wire.ApprovalRequestResponseApprove)
	if err != nil {
		t.Fatalf("Respond: %v", err)
	}
	if !called {
		t.Error("ResponderFunc should have been called")
	}
	if receivedResponse != wire.ApprovalRequestResponseApprove {
		t.Errorf("expected response 'approve', got %s", receivedResponse)
	}
}

func TestStdio_Close(t *testing.T) {
	// Create mock readers/writers
	r, w := io.Pipe()

	s := &stdio{
		WriteCloser: w,
		ReadCloser:  r,
	}

	err := s.Close()
	if err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Verify both are closed by checking that writes/reads fail
	_, writeErr := w.Write([]byte("test"))
	if writeErr == nil {
		t.Error("expected write to fail after close")
	}

	_, readErr := r.Read(make([]byte, 1))
	if readErr == nil {
		t.Error("expected read to fail after close")
	}
}
