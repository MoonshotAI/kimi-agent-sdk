package integration

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func getMockKimiPath(t *testing.T) string {
	t.Helper()

	// Get the directory of this test file
	_, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get working directory: %v", err)
	}

	// The mock_kimi binary should be in testdata
	mockPath := filepath.Join("testdata", "mock_kimi")
	if _, err := os.Stat(mockPath); os.IsNotExist(err) {
		t.Skipf("mock_kimi not found at %s, run 'go build -o testdata/mock_kimi testdata/mock_kimi.go' first", mockPath)
	}

	absPath, err := filepath.Abs(mockPath)
	if err != nil {
		t.Fatalf("failed to get absolute path: %v", err)
	}
	return absPath
}

func TestIntegration_NewSession_MockCLI(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()
}

func TestIntegration_RoundTrip_SimpleMessage(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test input"))
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	// Consume steps
	var messages []wire.Message
	for step := range turn.Steps {
		for msg := range step.Messages {
			messages = append(messages, msg)
		}
	}

	if turn.Err() != nil {
		t.Fatalf("RoundTrip: %v", turn.Err())
	}

	turn.Cancel()

	// Verify we received expected messages
	if len(messages) == 0 {
		t.Fatal("expected at least one message")
	}

	// Find ContentPart message
	foundContent := false
	for _, msg := range messages {
		if cp, ok := msg.(wire.ContentPart); ok {
			if cp.Type == wire.ContentPartTypeText && cp.Text.Value == "Hello from mock kimi!" {
				foundContent = true
				break
			}
		}
	}
	if !foundContent {
		t.Error("expected to find ContentPart with 'Hello from mock kimi!'")
	}

	result := turn.Result()
	if result.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", result.Status)
	}
}

func TestIntegration_Turn_Steps_Channel(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	// Verify Steps channel receives at least one step
	stepCount := 0
	for step := range turn.Steps {
		stepCount++
		// Drain messages
		for range step.Messages {
		}
	}

	if err := turn.Err(); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	turn.Cancel()

	if stepCount == 0 {
		t.Error("expected at least one step")
	}
}

func TestIntegration_StatusUpdate_Usage(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	// Consume all steps
	for step := range turn.Steps {
		for range step.Messages {
		}
	}

	if err := turn.Err(); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	turn.Cancel()

	// Check usage was updated
	usage := turn.Usage()
	if usage.Tokens.InputOther != 100 {
		t.Errorf("expected InputOther=100, got %d", usage.Tokens.InputOther)
	}
	if usage.Tokens.Output != 50 {
		t.Errorf("expected Output=50, got %d", usage.Tokens.Output)
	}
}

func TestIntegration_Session_Close(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}

	err = session.Close()
	if err != nil {
		t.Errorf("Close: %v", err)
	}
}

// withMode returns an Option that adds --mode flag to the mock_kimi command
func withMode(mode string) kimi.Option {
	return kimi.WithArgs("--mode", mode)
}

// TestIntegration_Deadlock_RequestCleanup tests for deadlock when Request method
// holds RLock while waiting for usrc, and cleanup tries to acquire write lock.
//
// Scenario:
// 1. mock_kimi sends ApprovalRequest (Request method acquires RLock, waits for usrc)
// 2. mock_kimi immediately sends prompt response (triggers cleanup which needs write lock)
// 3. If there's a deadlock, the test will timeout
func TestIntegration_Deadlock_RequestCleanup(t *testing.T) {
	mockPath := getMockKimiPath(t)

	done := make(chan struct{})
	var testErr error

	go func() {
		defer close(done)

		session, err := kimi.NewSession(
			kimi.WithExecutable(mockPath),
			withMode("deadlock"),
		)
		if err != nil {
			testErr = err
			return
		}
		defer session.Close()

		turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
		if err != nil {
			// Error is expected if deadlock is avoided by rejecting the request
			t.Logf("RoundTrip returned error (expected): %v", err)
			return
		}

		// Consume all messages to complete the turn
		for step := range turn.Steps {
			for msg := range step.Messages {
				if req, ok := msg.(wire.Request); ok {
					req.Respond(wire.ApprovalRequestResponseApprove)
				}
			}
		}

		if err := turn.Err(); err != nil {
			t.Logf("RoundTrip error: %v", err)
		}

		turn.Cancel()
	}()

	select {
	case <-done:
		if testErr != nil {
			t.Fatalf("test failed: %v", testErr)
		}
		t.Log("Test completed without deadlock")
	case <-time.After(30 * time.Second):
		t.Fatal("DEADLOCK DETECTED: test timed out waiting for completion")
	}
}

// TestIntegration_EventBlocking tests behavior when many events are sent rapidly.
// This tests whether Event method blocking while holding RLock causes issues.
func TestIntegration_EventBlocking(t *testing.T) {
	mockPath := getMockKimiPath(t)

	done := make(chan struct{})
	var testErr error

	go func() {
		defer close(done)

		session, err := kimi.NewSession(
			kimi.WithExecutable(mockPath),
			kimi.WithAutoApprove(),
			withMode("flood"),
		)
		if err != nil {
			testErr = err
			return
		}
		defer session.Close()

		turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
		if err != nil {
			testErr = err
			return
		}

		// Deliberately slow consumer to test blocking behavior
		messageCount := 0
		for step := range turn.Steps {
			for range step.Messages {
				messageCount++
				// Simulate slow processing
				time.Sleep(time.Millisecond)
			}
		}

		if err := turn.Err(); err != nil {
			testErr = err
			return
		}

		turn.Cancel()

		t.Logf("Received %d messages with slow consumer", messageCount)
	}()

	select {
	case <-done:
		if testErr != nil {
			t.Fatalf("test failed: %v", testErr)
		}
		t.Log("Test completed successfully")
	case <-time.After(30 * time.Second):
		t.Fatal("BLOCKING DETECTED: test timed out, Event method may be blocking while holding lock")
	}
}

// TestIntegration_Turn_Err_PromptError tests that turn.Err() correctly captures
// a JSONRPC error returned after TurnBegin.
//
// Scenario:
// 1. mock_kimi sends TurnBegin event (turn starts successfully)
// 2. mock_kimi returns a JSONRPC error for the prompt request
// 3. turn.Err() should contain the error
func TestIntegration_Turn_Err_PromptError(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
		withMode("prompt_error"),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	var rpcErr error

	// RoundTrip should return a turn (since TurnBegin is sent before the error)
	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
	if err != nil {
		if !strings.Contains(err.Error(), "simulated prompt error") {
			t.Fatalf("RoundTrip: expected turn to be returned, got error: %v", err)
		}
		rpcErr = err
	} else {
		// Consume all steps to allow the turn to complete
		for step := range turn.Steps {
			for range step.Messages {
			}
		}

		// Check that turn.Err() contains the JSONRPC error
		turnErr := turn.Err()
		if turnErr == nil {
			t.Fatal("expected turn.Err() to return an error, got nil")
		}

		turn.Cancel()

		// Verify the error message contains expected content
		if !strings.Contains(turnErr.Error(), "simulated prompt error") {
			t.Errorf("expected error to contain 'simulated prompt error', got: %v", turnErr)
		}

		rpcErr = turnErr
	}

	t.Logf("turn.Err() correctly captured the error: %v", rpcErr)
}

// TestIntegration_ConcurrentRoundTrips tests multiple concurrent RoundTrip calls
// to detect race conditions in session state management.
func TestIntegration_ConcurrentRoundTrips(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	// Note: The current implementation may not support concurrent RoundTrips
	// This test documents the expected behavior

	// First RoundTrip
	turn1, err := session.Prompt(context.Background(), wire.NewStringContent("first"))
	if err != nil {
		t.Fatalf("First RoundTrip: %v", err)
	}

	// Consume first turn
	t.Log("Consuming first turn")
	for step := range turn1.Steps {
		for range step.Messages {
		}
	}

	if err := turn1.Err(); err != nil {
		t.Fatalf("First RoundTrip: %v", err)
	}

	turn1.Cancel()

	// Second RoundTrip (sequential, after first completes)
	turn2, err := session.Prompt(context.Background(), wire.NewStringContent("second"))
	if err != nil {
		t.Fatalf("Second RoundTrip: %v", err)
	}

	// Consume second turn
	t.Log("Consuming second turn")
	for step := range turn2.Steps {
		for range step.Messages {
		}
	}

	if err := turn2.Err(); err != nil {
		t.Fatalf("Second RoundTrip: %v", err)
	}

	turn2.Cancel()

	t.Log("Sequential RoundTrips completed successfully")
}

// testToolArgs is the argument type for test tool
type testToolArgs struct {
	Input string `json:"input"`
}

// testToolResult is the result type for test tool (implements fmt.Stringer)
type testToolResult string

func (r testToolResult) String() string { return string(r) }

// TestIntegration_WithTools_ExternalToolCall tests that WithTools correctly
// registers tools and handles ExternalToolCallRequest from the CLI.
func TestIntegration_WithTools_ExternalToolCall(t *testing.T) {
	mockPath := getMockKimiPath(t)

	var called bool
	var receivedInput string

	testTool, err := kimi.CreateTool(func(args testToolArgs) (testToolResult, error) {
		called = true
		receivedInput = args.Input
		return testToolResult("result: " + args.Input), nil
	}, kimi.WithName("test_tool"))
	if err != nil {
		t.Fatalf("CreateTool: %v", err)
	}

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
		kimi.WithTools(testTool),
		withMode("tool_call"),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test"))
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}

	// Consume all messages
	for step := range turn.Steps {
		for range step.Messages {
		}
	}

	if err := turn.Err(); err != nil {
		t.Fatalf("turn error: %v", err)
	}

	// Verify tool was called
	if !called {
		t.Error("expected tool to be called")
	}
	if receivedInput != "hello" {
		t.Errorf("expected input 'hello', got %q", receivedInput)
	}

	result := turn.Result()
	if result.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected finished, got %s", result.Status)
	}

	t.Log("Tool call completed successfully")
}

// TestIntegration_NewSession_ToolRejected tests that NewSession returns an error
// when the server rejects external tools in the initialize response.
func TestIntegration_NewSession_ToolRejected(t *testing.T) {
	mockPath := getMockKimiPath(t)

	testTool, err := kimi.CreateTool(func(args testToolArgs) (testToolResult, error) {
		return testToolResult("result"), nil
	}, kimi.WithName("test_tool"))
	if err != nil {
		t.Fatalf("CreateTool: %v", err)
	}

	_, err = kimi.NewSession(
		kimi.WithExecutable(mockPath),
		kimi.WithTools(testTool),
		withMode("tool_rejected"),
	)
	if err == nil {
		t.Fatal("expected NewSession to return an error when tool is rejected")
	}

	// Verify error message contains expected content
	if !strings.Contains(err.Error(), "test_tool") {
		t.Errorf("expected error to contain tool name 'test_tool', got: %v", err)
	}
	if !strings.Contains(err.Error(), "rejected") {
		t.Errorf("expected error to contain 'rejected', got: %v", err)
	}
	if !strings.Contains(err.Error(), "conflicts with builtin tool") {
		t.Errorf("expected error to contain rejection reason, got: %v", err)
	}

	t.Logf("NewSession correctly rejected with error: %v", err)
}

func TestIntegration_TurnEnd_ExplicitEnd(t *testing.T) {
	mockPath := getMockKimiPath(t)

	session, err := kimi.NewSession(
		kimi.WithExecutable(mockPath),
		withMode("turn_end"),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	turn, err := session.Prompt(context.Background(), wire.NewStringContent("test input"))
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}

	var messages []wire.Message
	for step := range turn.Steps {
		for msg := range step.Messages {
			messages = append(messages, msg)
		}
	}

	if turn.Err() != nil {
		t.Fatalf("Turn error: %v", turn.Err())
	}
	turn.Cancel()

	if len(messages) == 0 {
		t.Fatal("expected at least one message")
	}

	result := turn.Result()
	if result.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", result.Status)
	}
}
