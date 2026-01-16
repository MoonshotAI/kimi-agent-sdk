package transport

import (
	"errors"
	"net"
	"net/rpc"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func setupClientServer(t *testing.T, impl Transport) (Transport, func()) {
	t.Helper()

	c1, c2 := net.Pipe()

	// Server side
	srv := rpc.NewServer()
	srv.RegisterName("Transport", NewTransportServer(impl))
	go srv.ServeConn(c2)

	// Client side
	client := NewTransportClient(rpc.NewClient(c1))

	cleanup := func() {
		c1.Close()
		c2.Close()
	}

	return client, cleanup
}

func TestTransportClient_Prompt(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Prompt(gomock.Any()).DoAndReturn(func(p *wire.PromptParams) (*wire.PromptResult, error) {
		return &wire.PromptResult{
			Status: wire.PromptResultStatusFinished,
			Steps:  wire.Optional[int]{Valid: true, Value: 3},
		}, nil
	})

	client, cleanup := setupClientServer(t, mockImpl)
	defer cleanup()

	result, err := client.Prompt(&wire.PromptParams{
		UserInput: wire.NewStringContent("hello"),
	})

	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if result.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", result.Status)
	}
	if !result.Steps.Valid || result.Steps.Value != 3 {
		t.Errorf("expected steps=3, got %v", result.Steps)
	}
}

func TestTransportClient_Cancel(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Cancel(gomock.Any()).Return(&wire.CancelResult{}, nil)

	client, cleanup := setupClientServer(t, mockImpl)
	defer cleanup()

	result, err := client.Cancel(&wire.CancelParams{})

	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

// Note: TestTransportClient_Event and TestTransportClient_Request are skipped
// because they require JSON-RPC codec to properly serialize interface types.
// The standard gob encoding used by net/rpc cannot handle interface types.
// These methods are tested via integration tests instead.

func TestTransportServer_Event(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Event(gomock.Any()).Return(&wire.EventResult{}, nil)

	srv := NewTransportServer(mockImpl)

	arg := &wire.EventParams{
		Type:    wire.EventTypeContentPart,
		Payload: wire.NewTextContentPart("hello"),
	}
	reply := &wire.EventResult{}

	err := srv.Event(arg, reply)
	if err != nil {
		t.Fatalf("Event: %v", err)
	}
}

func TestTransportServer_Request(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Request(gomock.Any()).Return(&wire.ApprovalResponse{
		RequestID: "req-123",
		Response:  wire.ApprovalRequestResponseApprove,
	}, nil)

	srv := NewTransportServer(mockImpl)

	arg := &wire.RequestParams{
		Type: wire.RequestTypeApprovalRequest,
		Payload: wire.ApprovalRequest{
			ID:          "req-123",
			ToolCallID:  "tool-456",
			Sender:      "agent",
			Action:      "execute",
			Description: "Run command",
		},
	}
	var reply wire.RequestResult

	err := srv.Request(arg, &reply)
	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	ar, ok := reply.(*wire.ApprovalResponse)
	if !ok {
		t.Fatalf("expected *wire.ApprovalResponse, got %T", reply)
	}
	if ar.RequestID != "req-123" {
		t.Errorf("expected request_id 'req-123', got %s", ar.RequestID)
	}
	if ar.Response != wire.ApprovalRequestResponseApprove {
		t.Errorf("expected response 'approve', got %s", ar.Response)
	}
}

func TestTransportClient_Prompt_Error(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	expectedErr := errors.New("prompt failed")
	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Prompt(gomock.Any()).Return(nil, expectedErr)

	client, cleanup := setupClientServer(t, mockImpl)
	defer cleanup()

	_, err := client.Prompt(&wire.PromptParams{
		UserInput: wire.NewStringContent("hello"),
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTransportServer_Prompt(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Prompt(gomock.Any()).Return(&wire.PromptResult{
		Status: wire.PromptResultStatusFinished,
	}, nil)

	srv := NewTransportServer(mockImpl)

	arg := &wire.PromptParams{
		UserInput: wire.NewStringContent("hello"),
	}
	reply := &wire.PromptResult{}

	err := srv.Prompt(arg, reply)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if reply.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", reply.Status)
	}
}

func TestTransportServer_Cancel(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockImpl := NewMockTransport(ctrl)
	mockImpl.EXPECT().Cancel(gomock.Any()).Return(&wire.CancelResult{}, nil)

	srv := NewTransportServer(mockImpl)

	arg := &wire.CancelParams{}
	reply := &wire.CancelResult{}

	err := srv.Cancel(arg, reply)
	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
}
