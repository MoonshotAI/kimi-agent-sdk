// Package main implements the Ralph Loop pattern using the Kimi Agent SDK.
//
// Ralph Loop iteratively runs an AI agent until a verification command succeeds.
// Completion is verified by running actual commands, not by trusting agent output.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"

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
	// Parse command line flags
	promptFile := flag.String("prompt", "", "path to prompt file (required)")
	maxIterations := flag.Int("max-iterations", 10, "maximum iterations")
	workDir := flag.String("work-dir", ".", "working directory")
	verifyCmd := flag.String("verify-cmd", "", "command to verify completion (required)")
	flag.Parse()

	if *promptFile == "" {
		return fmt.Errorf("--prompt flag is required")
	}
	if *verifyCmd == "" {
		return fmt.Errorf("--verify-cmd flag is required")
	}

	// Read prompt file
	promptBytes, err := os.ReadFile(*promptFile)
	if err != nil {
		return fmt.Errorf("failed to read prompt file: %w", err)
	}
	prompt := string(promptBytes)

	// Create session with auto-approve for autonomous operation
	session, err := kimi.NewSession(
		kimi.WithWorkDir(*workDir),
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

	ctx := context.Background()

	// Check if already complete before starting
	if complete, _ := verifyCompletion(*verifyCmd, *workDir); complete {
		fmt.Println("Task already complete!")
		return nil
	}

	// Ralph Loop - iterate until verification passes
	for iteration := 1; iteration <= *maxIterations; iteration++ {
		fmt.Printf("\n=== Iteration %d/%d ===\n", iteration, *maxIterations)

		turn, err := session.Prompt(ctx, wire.NewStringContent(prompt))
		if err != nil {
			return fmt.Errorf("prompt failed at iteration %d: %w", iteration, err)
		}

		// Consume all messages and print output
		for step := range turn.Steps {
			for msg := range step.Messages {
				if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
					fmt.Print(cp.Text.Value)
				}
			}
		}

		if err := turn.Err(); err != nil {
			return fmt.Errorf("turn error at iteration %d: %w", iteration, err)
		}

		// Verify completion by running the actual verification command.
		// Never trust agent output - always verify externally.
		complete, output := verifyCompletion(*verifyCmd, *workDir)
		if complete {
			fmt.Printf("\n\nTask completed in %d iteration(s)\n", iteration)
			return nil
		}

		fmt.Printf("\n\nVerification failed, continuing...\nOutput: %s\n", output)
	}

	return fmt.Errorf("task not completed after %d iterations", *maxIterations)
}

// verifyCompletion runs the verification command and returns whether the task is complete.
// This is the source of truth - we never trust agent output.
func verifyCompletion(cmd, workDir string) (bool, string) {
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return false, "empty command"
	}

	c := exec.Command(parts[0], parts[1:]...)
	c.Dir = workDir
	output, err := c.CombinedOutput()

	// Command succeeded with exit code 0 = task complete
	return err == nil, string(output)
}
