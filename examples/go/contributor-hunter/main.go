// Package main implements a contributor analysis tool using the Kimi Agent SDK.
//
// This example demonstrates the simplest usage of the SDK by having an AI agent
// analyze a GitHub repository, find its top contributor, research their background,
// and save a report directly to a file.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	repoURL := flag.String("repo", "", "GitHub repository URL (required)")
	outputFile := flag.String("output", "", "output markdown report file (required)")
	promptFile := flag.String("prompt", "prompts/analyze-contributor.md", "path to prompt file")
	flag.Parse()

	if *repoURL == "" {
		return fmt.Errorf("--repo flag is required")
	}
	if *outputFile == "" {
		return fmt.Errorf("--output flag is required")
	}

	// Load prompt template
	promptBytes, err := os.ReadFile(*promptFile)
	if err != nil {
		return fmt.Errorf("failed to read prompt file: %w", err)
	}

	// Create session with auto-approve enabled
	session, err := kimi.NewSession(kimi.WithAutoApprove())
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer func() {
		if err := session.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to close session: %v\n", err)
		}
	}()

	// Build the full prompt with parameters
	prompt := fmt.Sprintf("%s\n\n## Parameters\n\n- Repository: %s\n- Output file: %s",
		string(promptBytes), *repoURL, *outputFile)

	fmt.Printf("Analyzing top contributor for %s...\n\n", *repoURL)

	// Execute analysis
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

	fmt.Printf("\n\nReport saved to: %s\n", *outputFile)
	return nil
}
