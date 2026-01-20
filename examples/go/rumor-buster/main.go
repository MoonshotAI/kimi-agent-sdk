// Package main implements a rumor verification tool using the Kimi Agent SDK.
//
// This example demonstrates the ExternalTool capability by having an AI agent
// verify claims and report results through a custom tool.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sync"
	"time"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

// Claim represents a statement to be verified.
type Claim struct {
	ID        string `json:"id"`
	Statement string `json:"statement"`
}

// VerificationResult is the argument type for the report_verification_result tool.
type VerificationResult struct {
	ClaimID      string   `json:"claim_id"`
	Verdict      string   `json:"verdict"`
	EvidenceURLs []string `json:"evidence_urls"`
	Summary      string   `json:"summary"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	claimsFile := flag.String("claims", "", "path to claims JSON file (required)")
	promptFile := flag.String("prompt", "prompts/verify-claims.md", "path to prompt file")
	outputFile := flag.String("output", "", "output report file (default: stdout)")
	flag.Parse()

	if *claimsFile == "" {
		return fmt.Errorf("--claims flag is required")
	}

	// Load claims from JSON file
	claimsData, err := os.ReadFile(*claimsFile)
	if err != nil {
		return fmt.Errorf("failed to read claims file: %w", err)
	}
	var claims []Claim
	if err := json.Unmarshal(claimsData, &claims); err != nil {
		return fmt.Errorf("failed to parse claims: %w", err)
	}

	if len(claims) == 0 {
		return fmt.Errorf("no claims found in file")
	}

	// Load prompt template
	promptBytes, err := os.ReadFile(*promptFile)
	if err != nil {
		return fmt.Errorf("failed to read prompt file: %w", err)
	}

	// Collect verification results from tool calls
	var (
		mu      sync.Mutex
		results []VerificationResult
	)

	// Create the external tool that the agent will call to report results
	reportTool, err := kimi.CreateTool(
		func(result VerificationResult) (string, error) {
			mu.Lock()
			results = append(results, result)
			mu.Unlock()
			fmt.Printf("[Tool] Received verification for claim %s: %s\n", result.ClaimID, result.Verdict)
			return fmt.Sprintf("Recorded verification for claim %s", result.ClaimID), nil
		},
		kimi.WithName("report_verification_result"),
		kimi.WithDescription("Report the verification result for a claim. Call this tool for each claim after verifying it."),
		kimi.WithFieldDescription("ClaimID", "The ID of the claim being verified"),
		kimi.WithFieldDescription("Verdict", "The verdict: 'fact' if the claim is true, 'rumor' if the claim is false or misleading"),
		kimi.WithFieldDescription("EvidenceURLs", "URLs of authoritative sources that support the verdict"),
		kimi.WithFieldDescription("Summary", "A brief (1-2 sentence) explanation of why the claim is a fact or rumor"),
	)
	if err != nil {
		return fmt.Errorf("failed to create tool: %w", err)
	}

	// Create session with the external tool
	session, err := kimi.NewSession(
		kimi.WithTools(reportTool),
		kimi.WithAutoApprove(),
	)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer func() {
		if err := session.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to close session: %v\n", err)
		}
	}()

	// Build the full prompt with claims
	claimsJSON, _ := json.MarshalIndent(claims, "", "  ")
	prompt := fmt.Sprintf("%s\n\n## Claims to Verify\n\n```json\n%s\n```", string(promptBytes), claimsJSON)

	fmt.Printf("Starting verification of %d claims...\n\n", len(claims))

	// Execute verification
	ctx := context.Background()
	turn, err := session.Prompt(ctx, wire.NewStringContent(prompt))
	if err != nil {
		return fmt.Errorf("prompt failed: %w", err)
	}

	// Consume all messages and print agent output
	for step := range turn.Steps {
		for msg := range step.Messages {
			if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
				fmt.Print(cp.Text.Value)
			}
		}
	}

	if err := turn.Err(); err != nil {
		return fmt.Errorf("turn error: %w", err)
	}

	// Generate the final report
	return generateReport(results, claims, *outputFile)
}

func generateReport(results []VerificationResult, claims []Claim, outputFile string) error {
	var out *os.File
	if outputFile == "" {
		out = os.Stdout
	} else {
		var err error
		out, err = os.Create(outputFile)
		if err != nil {
			return fmt.Errorf("failed to create output file: %w", err)
		}
		defer func() {
			if err := out.Close(); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to close output file: %v\n", err)
			}
		}()
	}

	// Create a map of claim IDs to statements for the report
	claimStatements := make(map[string]string)
	for _, c := range claims {
		claimStatements[c.ID] = c.Statement
	}

	w := func(format string, args ...any) {
		_, _ = fmt.Fprintf(out, format, args...)
	}

	w("\n\n========================================\n")
	w("       RUMOR BUSTER REPORT\n")
	w("       Generated: %s\n", time.Now().Format(time.RFC3339))
	w("========================================\n\n")

	facts, rumors := 0, 0
	for _, r := range results {
		verdict := "FACT"
		symbol := "\u2713" // checkmark
		if r.Verdict == "rumor" {
			verdict = "RUMOR"
			symbol = "\u2717" // X mark
			rumors++
		} else {
			facts++
		}

		statement := claimStatements[r.ClaimID]
		w("[%s] %s %s\n", r.ClaimID, symbol, verdict)
		if statement != "" {
			w("Claim: %s\n", statement)
		}
		w("Summary: %s\n", r.Summary)
		if len(r.EvidenceURLs) > 0 {
			w("Evidence:\n")
			for _, url := range r.EvidenceURLs {
				w("  - %s\n", url)
			}
		}
		w("\n")
	}

	// Check for missing claims
	verifiedClaims := make(map[string]bool)
	for _, r := range results {
		verifiedClaims[r.ClaimID] = true
	}
	var missing []string
	for _, c := range claims {
		if !verifiedClaims[c.ID] {
			missing = append(missing, c.ID)
		}
	}
	if len(missing) > 0 {
		w("WARNING: The following claims were not verified: %v\n\n", missing)
	}

	w("========================================\n")
	w("Summary: %d facts, %d rumors verified\n", facts, rumors)
	w("Total claims: %d, Verified: %d\n", len(claims), len(results))
	w("========================================\n")

	return nil
}
