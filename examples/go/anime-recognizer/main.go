// Package main implements an anime screenshot recognition tool using the Kimi Agent SDK.
//
// This example demonstrates the multimodal (vision) capability by having an AI agent
// analyze anime screenshots, identify the anime and episode, and rename files accordingly.
package main

import (
	"context"
	"encoding/base64"
	"flag"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	_ "golang.org/x/image/webp"
)

// RecognitionResult is the argument type for the report_recognition_result tool.
type RecognitionResult struct {
	ImagePath  string `json:"image_path"`
	AnimeName  string `json:"anime_name"`
	Episode    string `json:"episode"`
	Confidence string `json:"confidence"`
	Notes      string `json:"notes,omitempty"`
}

// RenameAction represents a file rename operation.
type RenameAction struct {
	OriginalPath string
	NewPath      string
	AnimeName    string
	Episode      string
	Confidence   string
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	inputDir := flag.String("input", "", "directory containing anime screenshots (required)")
	outputDir := flag.String("output", "", "output directory for renamed files (default: same as input)")
	promptFile := flag.String("prompt", "prompts/recognize-anime.md", "path to prompt file")
	dryRun := flag.Bool("dry-run", false, "preview renames without executing")
	flag.Parse()

	if *inputDir == "" {
		return fmt.Errorf("--input flag is required")
	}

	if *outputDir == "" {
		*outputDir = *inputDir
	}

	// Ensure output directory exists
	if err := os.MkdirAll(*outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Scan for image files
	images, err := scanImages(*inputDir)
	if err != nil {
		return fmt.Errorf("failed to scan images: %w", err)
	}

	if len(images) == 0 {
		fmt.Println("No image files found in the input directory.")
		return nil
	}

	fmt.Printf("Found %d image(s) to process.\n\n", len(images))

	// Load prompt template
	promptBytes, err := os.ReadFile(*promptFile)
	if err != nil {
		return fmt.Errorf("failed to read prompt file: %w", err)
	}

	// Collect recognition results from tool calls
	var (
		mu      sync.Mutex
		results []RecognitionResult
	)

	// Create the external tool that the agent will call to report results
	reportTool, err := kimi.CreateTool(
		func(result RecognitionResult) (string, error) {
			mu.Lock()
			results = append(results, result)
			mu.Unlock()
			fmt.Printf("[Tool] Recognized %s: %s - %s (confidence: %s)\n",
				filepath.Base(result.ImagePath), result.AnimeName, result.Episode, result.Confidence)
			return fmt.Sprintf("Recorded recognition for %s", result.ImagePath), nil
		},
		kimi.WithName("report_recognition_result"),
		kimi.WithDescription("Report the recognition result for an anime screenshot. Call this tool for each image after identifying the anime."),
		kimi.WithFieldDescription("ImagePath", "The original file path of the image being recognized"),
		kimi.WithFieldDescription("AnimeName", "The romanized anime title (use common English title for filename compatibility)"),
		kimi.WithFieldDescription("Episode", "Episode identifier: E01, E02 for episodes; Movie, Movie1 for movies; OVA1, OVA2 for OVAs; Special1, Special2 for specials"),
		kimi.WithFieldDescription("Confidence", "Confidence level: high, medium, or low"),
		kimi.WithFieldDescription("Notes", "Optional notes about the identification"),
	)
	if err != nil {
		return fmt.Errorf("failed to create tool: %w", err)
	}

	// Create session with the external tool
	session, err := kimi.NewSession(
		kimi.WithTools(reportTool),
		kimi.WithWorkDir(*inputDir),
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

	// Process each image
	ctx := context.Background()
	for i, imagePath := range images {
		fmt.Printf("\n[%d/%d] Processing: %s\n", i+1, len(images), filepath.Base(imagePath))

		// Convert image to data URL
		dataURL, err := imageToDataURL(imagePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to process %s: %v\n", imagePath, err)
			continue
		}

		// Build multimodal content
		content := wire.NewContent(
			wire.NewTextContentPart(fmt.Sprintf("%s\n\n## Image to Analyze\n\nFile path: %s\n\nPlease analyze this anime screenshot and call the report_recognition_result tool with your findings.",
				string(promptBytes), imagePath)),
			wire.NewImageContentPart(dataURL),
		)

		// Execute recognition
		turn, err := session.Prompt(ctx, content)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: prompt failed for %s: %v\n", imagePath, err)
			continue
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
			fmt.Fprintf(os.Stderr, "Warning: turn error for %s: %v\n", imagePath, err)
		}
	}

	// Generate rename actions
	actions := generateRenameActions(results, *outputDir)

	// Print summary and execute renames
	fmt.Printf("\n\n========================================\n")
	fmt.Printf("       ANIME RECOGNIZER RESULTS\n")
	fmt.Printf("========================================\n\n")

	if len(actions) == 0 {
		fmt.Println("No files to rename.")
		return nil
	}

	fmt.Printf("Rename operations%s:\n\n", ifStr(*dryRun, " (DRY RUN)", ""))

	for _, action := range actions {
		fmt.Printf("  %s\n", filepath.Base(action.OriginalPath))
		fmt.Printf("    -> %s\n", filepath.Base(action.NewPath))
		fmt.Printf("    Anime: %s, Episode: %s, Confidence: %s\n\n",
			action.AnimeName, action.Episode, action.Confidence)
	}

	if *dryRun {
		fmt.Println("Dry run mode - no files were renamed.")
		return nil
	}

	// Execute renames
	successCount := 0
	for _, action := range actions {
		if err := os.Rename(action.OriginalPath, action.NewPath); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to rename %s: %v\n",
				filepath.Base(action.OriginalPath), err)
		} else {
			successCount++
		}
	}

	fmt.Printf("\n========================================\n")
	fmt.Printf("Summary: %d/%d files renamed successfully\n", successCount, len(actions))
	fmt.Printf("========================================\n")

	return nil
}

// scanImages finds all image files in the given directory.
func scanImages(dir string) ([]string, error) {
	var images []string
	extensions := map[string]bool{
		".png":  true,
		".jpg":  true,
		".jpeg": true,
		".gif":  true,
		".webp": true,
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if extensions[ext] {
			images = append(images, filepath.Join(dir, entry.Name()))
		}
	}

	return images, nil
}

// imageToDataURL converts an image file to a data URL.
func imageToDataURL(path string) (string, error) {
	// Read the file
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}

	// Detect actual image format using image.DecodeConfig
	reader := strings.NewReader(string(data))
	_, format, err := image.DecodeConfig(reader)
	if err != nil {
		return "", fmt.Errorf("detect image format: %w", err)
	}

	// Map format to MIME type
	mimeType := "image/" + format
	if format == "jpeg" {
		mimeType = "image/jpeg"
	}

	// Encode to base64
	encoded := base64.StdEncoding.EncodeToString(data)

	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}

// generateRenameActions creates rename actions from recognition results.
func generateRenameActions(results []RecognitionResult, outputDir string) []RenameAction {
	var actions []RenameAction
	usedNames := make(map[string]int)

	for _, result := range results {
		if result.AnimeName == "" || result.AnimeName == "Unknown" {
			continue
		}

		// Sanitize anime name for filename
		safeName := sanitizeFilename(result.AnimeName)
		episode := result.Episode
		if episode == "" {
			episode = "Unknown"
		}

		// Get original extension
		ext := strings.ToLower(filepath.Ext(result.ImagePath))

		// Generate base filename
		baseFilename := fmt.Sprintf("%s-%s", safeName, episode)

		// Handle conflicts by appending suffix
		filename := baseFilename + ext
		if count, exists := usedNames[filename]; exists {
			usedNames[filename] = count + 1
			filename = fmt.Sprintf("%s-%d%s", baseFilename, count+1, ext)
		} else {
			usedNames[filename] = 1
		}

		newPath := filepath.Join(outputDir, filename)

		actions = append(actions, RenameAction{
			OriginalPath: result.ImagePath,
			NewPath:      newPath,
			AnimeName:    result.AnimeName,
			Episode:      result.Episode,
			Confidence:   result.Confidence,
		})
	}

	return actions
}

// sanitizeFilename removes or replaces characters that are not safe for filenames.
func sanitizeFilename(name string) string {
	// Replace spaces with underscores
	name = strings.ReplaceAll(name, " ", "_")

	// Remove or replace unsafe characters
	re := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)
	name = re.ReplaceAllString(name, "")

	// Trim leading/trailing spaces and dots
	name = strings.Trim(name, " .")

	// Limit length
	if len(name) > 100 {
		name = name[:100]
	}

	if name == "" {
		name = "Unknown"
	}

	return name
}

// ifStr returns trueVal if condition is true, otherwise falseVal.
func ifStr(condition bool, trueVal, falseVal string) string {
	if condition {
		return trueVal
	}
	return falseVal
}
