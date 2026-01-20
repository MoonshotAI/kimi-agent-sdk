package e2e

import (
	"context"
	"fmt"
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

	turn, err := session.Prompt(ctx, wire.NewStringContent("Say 'Hello, test!' and nothing else."))
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}

	// Collect all messages
	var textContent strings.Builder
	for step := range turn.Steps {
		for msg := range step.Messages {
			if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
				textContent.WriteString(cp.Text.Value)
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

	_, err = session.Prompt(ctx, wire.NewStringContent("Write a 1000 word essay about AI."))
	if err == nil {
		t.Errorf("request completed before cancellation")
	}
	t.Logf("Request cancelled as expected: %v", err)
}

func TestE2E_RumorBuster(t *testing.T) {
	skipIfNoAPIKey(t)

	// 1. Define test claim (simplified, just one claim)
	claim := "The Great Wall of China is visible from space with the naked eye"

	// 2. Create tool to collect verification results
	var result struct {
		ClaimID      string
		Verdict      string
		EvidenceURLs []string
		Summary      string
	}
	var toolCalled bool

	reportTool, err := kimi.CreateTool(
		func(args struct {
			ClaimID      string   `json:"claim_id"`
			Verdict      string   `json:"verdict"`
			EvidenceURLs []string `json:"evidence_urls"`
			Summary      string   `json:"summary"`
		}) (string, error) {
			toolCalled = true
			result.ClaimID = args.ClaimID
			result.Verdict = args.Verdict
			result.EvidenceURLs = args.EvidenceURLs
			result.Summary = args.Summary
			return "Recorded verification", nil
		},
		kimi.WithName("report_verification_result"),
		kimi.WithDescription("Report the verification result for a claim"),
	)
	if err != nil {
		t.Fatalf("CreateTool: %v", err)
	}

	// 3. Create session with tool
	session, err := kimi.NewSession(
		kimi.WithTools(reportTool),
		kimi.WithAutoApprove(),
	)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	defer session.Close()

	// 4. Send prompt (simplified version of verify-claims.md)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	prompt := fmt.Sprintf(`You are a fact-checker. Verify the following claim and call the report_verification_result tool:

Claim ID: claim-1
Statement: %s

Search the web, determine if this is a fact or rumor, then call the tool with your findings.`, claim)

	turn, err := session.Prompt(ctx, wire.NewStringContent(prompt))
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}

	// 5. Consume all messages
	for step := range turn.Steps {
		for range step.Messages {
		}
	}

	if err := turn.Err(); err != nil {
		t.Fatalf("Turn error: %v", err)
	}

	// 6. Verify results
	if turn.Result().Status != wire.PromptResultStatusFinished {
		t.Errorf("expected finished, got %s", turn.Result().Status)
	}

	if !toolCalled {
		t.Error("expected tool to be called")
	}

	if result.ClaimID != "claim-1" {
		t.Errorf("expected ClaimID 'claim-1', got %q", result.ClaimID)
	}

	// Verdict should be "rumor" (Great Wall is NOT visible from space)
	if result.Verdict != "rumor" {
		t.Logf("Note: Verdict was %q (expected 'rumor')", result.Verdict)
	}

	t.Logf("Verification result: %+v", result)
}
