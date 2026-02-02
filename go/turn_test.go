package kimi

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire/transport"
)

// setupTurn creates a Turn for testing with proper cleanup (uses default version "1.1")
// Returns 5 values to maintain backward compatibility with existing tests
func setupTurn(t *testing.T) (
	*Turn,
	*transport.MockTransport,
	chan wire.Message,
	context.CancelFunc,
	func(),
) {
	turn, mockTP, msgs, cancel, _, cleanup := setupTurnWithVersion(t, "1.1")
	return turn, mockTP, msgs, cancel, cleanup
}

// setupTurnWithVersion creates a Turn with specified wire protocol version
// Returns: turn, mockTransport, msgs channel, cancel func, closeMsgs func, cleanup func
func setupTurnWithVersion(t *testing.T, wireProtocolVersion string) (
	*Turn,
	*transport.MockTransport,
	chan wire.Message,
	context.CancelFunc,
	func(), // closeMsgs - call this to close msgs channel
	func(), // cleanup - call this at the end (will call closeMsgs internally if not already called)
) {
	t.Helper()
	ctrl := gomock.NewController(t)

	mockTP := transport.NewMockTransport(ctrl)
	mockTP.EXPECT().Cancel(gomock.Any()).Return(&wire.CancelResult{}, nil).AnyTimes()

	result := new(atomic.Pointer[wire.PromptResult])
	result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})

	msgs := make(chan wire.Message, 10)
	usrc := make(chan wire.RequestResponse, 1)
	exit := func(err error) error { return err }

	ctx, cancel := context.WithCancel(context.Background())

	turn := turnBegin(ctx, 0, mockTP, new(atomic.Pointer[error]), result, wireProtocolVersion, msgs, usrc, exit)

	var closeOnce sync.Once
	closeMsgs := func() {
		closeOnce.Do(func() { close(msgs) })
	}

	cleanup := func() {
		closeMsgs() // safe to call multiple times
		cancel()
		time.Sleep(50 * time.Millisecond)
		ctrl.Finish()
	}

	return turn, mockTP, msgs, cancel, closeMsgs, cleanup
}

func TestTurn_Result_Pending(t *testing.T) {
	turn, _, _, _, cleanup := setupTurn(t)
	defer cleanup()

	got := turn.Result()
	if got.Status != wire.PromptResultStatusPending {
		t.Errorf("expected status pending, got %s", got.Status)
	}
}

func TestTurn_Result_Finished(t *testing.T) {
	ctrl := gomock.NewController(t)

	mockTP := transport.NewMockTransport(ctrl)
	mockTP.EXPECT().Cancel(gomock.Any()).Return(&wire.CancelResult{}, nil).AnyTimes()

	result := new(atomic.Pointer[wire.PromptResult])
	result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})

	msgs := make(chan wire.Message, 10)
	usrc := make(chan wire.RequestResponse, 1)
	exit := func(err error) error { return err }

	ctx, cancel := context.WithCancel(context.Background())

	turn := turnBegin(ctx, 0, mockTP, new(atomic.Pointer[error]), result, "1.1", msgs, usrc, exit)

	// Update result to finished
	result.Store(&wire.PromptResult{
		Status: wire.PromptResultStatusFinished,
		Steps:  wire.Optional[int]{Valid: true, Value: 3},
	})

	got := turn.Result()
	if got.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", got.Status)
	}
	if !got.Steps.Valid || got.Steps.Value != 3 {
		t.Errorf("expected steps=3, got %v", got.Steps)
	}

	close(msgs)
	cancel()
	time.Sleep(50 * time.Millisecond)
	ctrl.Finish()
}

func TestTurn_Usage_Initial(t *testing.T) {
	turn, _, _, _, cleanup := setupTurn(t)
	defer cleanup()

	usage := turn.Usage()
	if usage.Context != 0 {
		t.Errorf("expected Context=0, got %f", usage.Context)
	}
	if usage.Tokens.InputOther != 0 {
		t.Errorf("expected InputOther=0, got %d", usage.Tokens.InputOther)
	}
	if usage.Tokens.Output != 0 {
		t.Errorf("expected Output=0, got %d", usage.Tokens.Output)
	}
}

func TestTurn_Cancel(t *testing.T) {
	ctrl := gomock.NewController(t)

	mockTP := transport.NewMockTransport(ctrl)
	mockTP.EXPECT().Cancel(gomock.Any()).Return(&wire.CancelResult{}, nil).AnyTimes()

	result := new(atomic.Pointer[wire.PromptResult])
	result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})

	msgs := make(chan wire.Message, 10)
	usrc := make(chan wire.RequestResponse, 1)

	var exitCalled atomic.Bool
	exit := func(err error) error {
		exitCalled.Store(true)
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())

	turn := turnBegin(ctx, 0, mockTP, new(atomic.Pointer[error]), result, "1.1", msgs, usrc, exit)

	err := turn.Cancel()
	if err != nil {
		t.Errorf("Cancel() returned error: %v", err)
	}
	if !exitCalled.Load() {
		t.Errorf("exit function should have been called")
	}

	close(msgs)
	cancel()
	time.Sleep(50 * time.Millisecond)
	ctrl.Finish()
}

func TestTurn_traverse_StepBegin(t *testing.T) {
	turn, _, msgs, cancel, cleanup := setupTurn(t)
	defer cleanup()

	// Send TurnBegin first (required by traverse)
	msgs <- wire.TurnBegin{}

	// Send StepBegin event
	msgs <- wire.StepBegin{N: 1}

	// Verify step is created
	select {
	case step := <-turn.Steps:
		if step == nil {
			t.Fatal("expected step, got nil")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for step")
	}
}

func TestTurn_traverse_ContentPart(t *testing.T) {
	turn, _, msgs, cancel, cleanup := setupTurn(t)
	defer cleanup()

	// Send TurnBegin first (required by traverse)
	msgs <- wire.TurnBegin{}

	// Send StepBegin first to create a step
	msgs <- wire.StepBegin{N: 1}

	// Send ContentPart event
	contentPart := wire.NewTextContentPart("Hello, world!")
	msgs <- contentPart

	// Verify step receives the content part
	select {
	case step := <-turn.Steps:
		if step == nil {
			t.Fatal("expected step, got nil")
		}
		select {
		case msg := <-step.Messages:
			cp, ok := msg.(wire.ContentPart)
			if !ok {
				t.Fatalf("expected ContentPart, got %T", msg)
			}
			if cp.Text.Value != "Hello, world!" {
				t.Errorf("expected text 'Hello, world!', got %s", cp.Text.Value)
			}
		case <-time.After(time.Second):
			cancel()
			t.Fatal("timeout waiting for message")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for step")
	}
}

func TestTurn_traverse_StatusUpdate_ContextUsage(t *testing.T) {
	turn, _, msgs, _, cleanup := setupTurn(t)
	defer cleanup()

	// Send TurnBegin first (required by traverse)
	msgs <- wire.TurnBegin{}

	// Send StatusUpdate with ContextUsage
	msgs <- wire.StatusUpdate{
		ContextUsage: wire.Optional[float64]{Valid: true, Value: 0.75},
	}

	// Wait for traverse to process
	time.Sleep(100 * time.Millisecond)

	usage := turn.Usage()
	if usage.Context != 0.75 {
		t.Errorf("expected Context=0.75, got %f", usage.Context)
	}
}

func TestTurn_traverse_StatusUpdate_TokenUsage(t *testing.T) {
	turn, _, msgs, _, cleanup := setupTurn(t)
	defer cleanup()

	// Send TurnBegin first (required by traverse)
	msgs <- wire.TurnBegin{}

	// Send first StatusUpdate with TokenUsage
	msgs <- wire.StatusUpdate{
		TokenUsage: wire.Optional[wire.TokenUsage]{
			Valid: true,
			Value: wire.TokenUsage{
				InputOther:         100,
				Output:             50,
				InputCacheRead:     10,
				InputCacheCreation: 5,
			},
		},
	}

	// Send second StatusUpdate to test accumulation
	msgs <- wire.StatusUpdate{
		TokenUsage: wire.Optional[wire.TokenUsage]{
			Valid: true,
			Value: wire.TokenUsage{
				InputOther:         200,
				Output:             100,
				InputCacheRead:     20,
				InputCacheCreation: 10,
			},
		},
	}

	// Wait for traverse to process
	time.Sleep(100 * time.Millisecond)

	usage := turn.Usage()
	if usage.Tokens.InputOther != 300 {
		t.Errorf("expected InputOther=300, got %d", usage.Tokens.InputOther)
	}
	if usage.Tokens.Output != 150 {
		t.Errorf("expected Output=150, got %d", usage.Tokens.Output)
	}
	if usage.Tokens.InputCacheRead != 30 {
		t.Errorf("expected InputCacheRead=30, got %d", usage.Tokens.InputCacheRead)
	}
	if usage.Tokens.InputCacheCreation != 15 {
		t.Errorf("expected InputCacheCreation=15, got %d", usage.Tokens.InputCacheCreation)
	}
}

func TestTurn_watch_ContextCancel(t *testing.T) {
	ctrl := gomock.NewController(t)

	mockTP := transport.NewMockTransport(ctrl)
	// Expect Cancel to be called when context is cancelled
	cancelCalled := make(chan struct{})
	mockTP.EXPECT().Cancel(gomock.Any()).DoAndReturn(func(params *wire.CancelParams) (*wire.CancelResult, error) {
		close(cancelCalled)
		return &wire.CancelResult{}, nil
	})

	result := new(atomic.Pointer[wire.PromptResult])
	result.Store(&wire.PromptResult{Status: wire.PromptResultStatusPending})

	msgs := make(chan wire.Message, 10)
	usrc := make(chan wire.RequestResponse, 1)
	exit := func(err error) error { return err }

	ctx, cancel := context.WithCancel(context.Background())

	_ = turnBegin(ctx, 0, mockTP, new(atomic.Pointer[error]), result, "1.1", msgs, usrc, exit)

	// Cancel the context
	cancel()

	// Verify Cancel was called
	select {
	case <-cancelCalled:
		// success
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for Cancel to be called")
	}

	close(msgs)
	time.Sleep(50 * time.Millisecond)
	ctrl.Finish()
}

func TestTurn_traverse_TurnEnd(t *testing.T) {
	turn, _, msgs, cancel, _, cleanup := setupTurnWithVersion(t, "1.2")
	defer cleanup()

	msgs <- wire.TurnBegin{}
	msgs <- wire.StepBegin{N: 1}

	select {
	case step := <-turn.Steps:
		if step == nil {
			t.Fatal("expected step, got nil")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for step")
	}

	msgs <- wire.TurnEnd{}

	select {
	case _, ok := <-turn.Steps:
		if ok {
			t.Fatal("expected Steps channel to be closed after TurnEnd")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for Steps channel to close")
	}

	// Verify result is NOT UnexpectedEOF (TurnEnd was received)
	result := turn.Result()
	if result.Status == wire.PromptResultStatusUnexpectedEOF {
		t.Error("expected result status to NOT be UnexpectedEOF when TurnEnd was received")
	}
}

func TestTurn_traverse_TurnEnd_BeforeStepBegin(t *testing.T) {
	turn, _, msgs, cancel, _, cleanup := setupTurnWithVersion(t, "1.2")
	defer cleanup()

	msgs <- wire.TurnBegin{}
	msgs <- wire.TurnEnd{}

	select {
	case _, ok := <-turn.Steps:
		if ok {
			t.Fatal("expected Steps channel to be closed after TurnEnd")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for Steps channel to close")
	}
}

func TestTurn_traverse_UnexpectedEOF_WireVersion12(t *testing.T) {
	turn, _, msgs, cancel, closeMsgs, cleanup := setupTurnWithVersion(t, "1.2")
	defer cleanup()

	msgs <- wire.TurnBegin{}
	msgs <- wire.StepBegin{N: 1}

	select {
	case step := <-turn.Steps:
		if step == nil {
			t.Fatal("expected step, got nil")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for step")
	}

	// Close msgs WITHOUT sending TurnEnd (use closeMsgs to avoid double-close panic)
	closeMsgs()

	// Wait for Steps channel to close
	select {
	case _, ok := <-turn.Steps:
		if ok {
			t.Fatal("expected Steps channel to be closed")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for Steps channel to close")
	}

	// Verify result is UnexpectedEOF
	result := turn.Result()
	if result.Status != wire.PromptResultStatusUnexpectedEOF {
		t.Errorf("expected status UnexpectedEOF, got %s", result.Status)
	}
}

func TestTurn_traverse_NoUnexpectedEOF_WireVersion11(t *testing.T) {
	turn, _, msgs, cancel, closeMsgs, cleanup := setupTurnWithVersion(t, "1.1")
	defer cleanup()

	msgs <- wire.TurnBegin{}
	msgs <- wire.StepBegin{N: 1}

	select {
	case step := <-turn.Steps:
		if step == nil {
			t.Fatal("expected step, got nil")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for step")
	}

	// Close msgs WITHOUT sending TurnEnd (use closeMsgs to avoid double-close panic)
	closeMsgs()

	// Wait for Steps channel to close
	select {
	case _, ok := <-turn.Steps:
		if ok {
			t.Fatal("expected Steps channel to be closed")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("timeout waiting for Steps channel to close")
	}

	// Verify result is NOT UnexpectedEOF (version < 1.2)
	result := turn.Result()
	if result.Status == wire.PromptResultStatusUnexpectedEOF {
		t.Error("expected status to NOT be UnexpectedEOF for wire version < 1.2")
	}
}
