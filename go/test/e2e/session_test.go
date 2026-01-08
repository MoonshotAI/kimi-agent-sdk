package e2e

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

// These tests require:
// 1. kimi CLI installed and in PATH
// 2. KIMI_API_KEY environment variable set
//
// Run with: KIMI_API_KEY=xxx go test -v ./test/e2e/...

func skipIfNoAPIKey(t *testing.T) {
	t.Helper()
	if os.Getenv("KIMI_API_KEY") == "" {
		t.Skip("KIMI_API_KEY not set, skipping E2E test")
	}
}

func TestE2E_RealKimiCLI(t *testing.T) {
	skipIfNoAPIKey(t)

	session, err := kimi.NewSession(
		kimi.WithAutoApprove(),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	turn, err := session.RoundTrip(ctx, wire.NewStringUserInput("Say 'Hello, test!' and nothing else."))
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	// Collect all messages
	var textContent strings.Builder
	for step := range turn.Steps {
		for msg := range step.Messages {
			if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
				textContent.WriteString(cp.Text)
			}
		}
	}

	t.Logf("Response: %s", textContent.String())

	result := turn.Result()
	if result.Status != wire.PromptResultStatusFinished {
		t.Errorf("expected status finished, got %s", result.Status)
	}

	// Check usage was recorded
	usage := turn.Usage()
	if usage.Tokens.InputOther == 0 && usage.Tokens.Output == 0 {
		t.Error("expected non-zero token usage")
	}
	t.Logf("Usage: InputOther=%d, Output=%d", usage.Tokens.InputOther, usage.Tokens.Output)
}

func TestE2E_ContextTimeout(t *testing.T) {
	skipIfNoAPIKey(t)

	session, err := kimi.NewSession(
		kimi.WithAutoApprove(),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	// Cancel the context directly to trigger cancellation
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = session.RoundTrip(ctx, wire.NewStringUserInput("Write a 1000 word essay about AI."))
	if err == nil {
		t.Errorf("request completed before cancellation")
	}
	t.Logf("Request cancelled as expected: %v", err)
}
