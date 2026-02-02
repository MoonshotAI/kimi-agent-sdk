//go:build ignore
// +build ignore

// mock_kimi is a mock implementation of the kimi CLI for testing purposes.
// Build: go build -o mock_kimi mock_kimi.go
// Usage: ./mock_kimi --wire [--mode <mode>]
//
// Modes:
//   normal (default) - standard behavior
//   deadlock - sends ApprovalRequest then immediately completes prompt
//   flood - sends many events rapidly
//   prompt_error - sends TurnBegin then returns a JSONRPC error
//   tool_call - sends ToolCall request and waits for response
//   tool_rejected - returns rejected external tools in initialize response
//   turn_end - sends TurnEnd event to explicitly end the turn

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync/atomic"
)

var (
	requestID atomic.Uint64
	mode      string
)

type Payload struct {
	Version string          `json:"jsonrpc"`
	ID      string          `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

type PromptParams struct {
	UserInput json.RawMessage `json:"user_input"`
}

func main() {
	// Parse arguments
	hasWire := false
	hasInfo := false
	for i, arg := range os.Args[1:] {
		switch arg {
		case "--wire":
			hasWire = true
		case "info":
			hasInfo = true
		case "--mode":
			if i+1 < len(os.Args)-1 {
				mode = os.Args[i+2]
			}
		}
	}

	// Handle info command
	if hasInfo {
		fmt.Println(`{"wire_protocol_version": "2"}`)
		os.Exit(0)
	}

	if !hasWire {
		fmt.Fprintln(os.Stderr, "missing --wire flag")
		os.Exit(1)
	}

	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)

	for scanner.Scan() {
		var req Payload
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}

		switch req.Method {
		case "initialize":
			handleInitialize(encoder, req.ID)
		case "prompt":
			switch mode {
			case "deadlock":
				handlePromptDeadlock(encoder, req.ID)
			case "flood":
				handlePromptFlood(encoder, req.ID)
			case "prompt_error":
				handlePromptError(encoder, req.ID)
			case "tool_call":
				handlePromptToolCall(encoder, scanner, req.ID)
			case "turn_end":
				handlePromptTurnEnd(encoder, req.ID)
			default:
				handlePrompt(encoder, req.ID)
			}
		case "cancel":
			handleCancel(encoder, req.ID)
		}
	}
}

func handleInitialize(encoder *json.Encoder, reqID string) {
	var result json.RawMessage
	if mode == "tool_rejected" {
		result = json.RawMessage(`{
			"protocol_version": "2",
			"server": {"name": "mock_kimi", "version": "0.0.1"},
			"slash_commands": [],
			"external_tools": {
				"accepted": [],
				"rejected": [{"name": "test_tool", "reason": "conflicts with builtin tool"}]
			}
		}`)
	} else {
		result = json.RawMessage(`{
			"protocol_version": "2",
			"server": {"name": "mock_kimi", "version": "0.0.1"},
			"slash_commands": []
		}`)
	}
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  result,
	})
}

func handlePrompt(encoder *json.Encoder, reqID string) {
	// Send TurnBegin event
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})

	// Send StepBegin event
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})

	// Send ContentPart event
	sendEvent(encoder, "ContentPart", map[string]any{
		"type": "text",
		"text": "Hello from mock kimi!",
	})

	// Send StatusUpdate event
	sendEvent(encoder, "StatusUpdate", map[string]any{
		"token_usage": map[string]any{
			"input_other":          100,
			"output":               50,
			"input_cache_read":     10,
			"input_cache_creation": 5,
		},
	})

	// Send TurnEnd event to properly end the turn
	sendEvent(encoder, "TurnEnd", map[string]any{})

	// Send prompt response
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{"status":"finished","steps":1}`),
	})
}

func handleCancel(encoder *json.Encoder, reqID string) {
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{}`),
	})
}

func sendEvent(encoder *json.Encoder, eventType string, payload any) {
	payloadJSON, _ := json.Marshal(payload)
	paramsJSON, _ := json.Marshal(map[string]any{
		"type":    eventType,
		"payload": json.RawMessage(payloadJSON),
	})

	id := requestID.Add(1)
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      fmt.Sprintf("evt-%d", id),
		Method:  "event",
		Params:  paramsJSON,
	})
}

func sendRequest(encoder *json.Encoder, requestType string, payload any) {
	payloadJSON, _ := json.Marshal(payload)
	paramsJSON, _ := json.Marshal(map[string]any{
		"type":    requestType,
		"payload": json.RawMessage(payloadJSON),
	})

	id := requestID.Add(1)
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      fmt.Sprintf("req-%d", id),
		Method:  "request",
		Params:  paramsJSON,
	})
}

// handlePromptDeadlock sends an ApprovalRequest then immediately completes the prompt
// This tests whether Request method holding RLock while waiting for usrc can deadlock
// with cleanup trying to acquire write lock
func handlePromptDeadlock(encoder *json.Encoder, reqID string) {
	// Send TurnBegin event
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})

	// Send StepBegin event
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})

	// Send ApprovalRequest - this will cause Request method to hold RLock and wait for usrc
	sendRequest(encoder, "ApprovalRequest", map[string]any{
		"request_id":       "approval-1",
		"tool_name":        "test_tool",
		"tool_input":       map[string]any{"arg": "value"},
		"tool_description": "A test tool",
	})

	// Immediately send prompt response WITHOUT waiting for approval response
	// This triggers cleanup which needs write lock, but Request still holds RLock
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{"status":"finished","steps":1}`),
	})
}

// handlePromptFlood sends many events rapidly to test Event blocking with RLock
func handlePromptFlood(encoder *json.Encoder, reqID string) {
	// Send TurnBegin event
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})

	// Send StepBegin event
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})

	// Flood with many events - if msgs channel blocks, Event will hold RLock
	for i := 0; i < 100; i++ {
		sendEvent(encoder, "ContentPart", map[string]any{
			"type": "text",
			"text": fmt.Sprintf("Message %d", i),
		})
	}

	// Send prompt response
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{"status":"finished","steps":1}`),
	})
}

// handlePromptError sends TurnBegin then returns a JSONRPC error.
// This tests whether turn.Err() correctly captures the error after TurnBegin.
func handlePromptError(encoder *json.Encoder, reqID string) {
	// Send TurnBegin event first
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})

	// Send StepBegin event so the turn can process messages
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})

	// Return a JSONRPC error response
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Error:   json.RawMessage(`{"code":-32000,"message":"simulated prompt error"}`),
	})
}

// handlePromptTurnEnd sends TurnEnd event to explicitly end the turn
func handlePromptTurnEnd(encoder *json.Encoder, reqID string) {
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})
	sendEvent(encoder, "ContentPart", map[string]any{
		"type": "text",
		"text": "Hello from mock kimi!",
	})
	sendEvent(encoder, "TurnEnd", map[string]any{})

	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{"status":"finished","steps":1}`),
	})
}

// handlePromptToolCall sends a ToolCall request and waits for response.
// This tests whether WithTools correctly registers tools and handles tool calls.
func handlePromptToolCall(encoder *json.Encoder, scanner *bufio.Scanner, reqID string) {
	// Send TurnBegin event
	sendEvent(encoder, "TurnBegin", map[string]any{
		"user_input": "test",
	})

	// Send StepBegin event
	sendEvent(encoder, "StepBegin", map[string]any{
		"n": 1,
	})

	// Send ToolCall request (Wire 1.1 format)
	toolReqID := fmt.Sprintf("req-%d", requestID.Add(1))
	payloadJSON, _ := json.Marshal(map[string]any{
		"id":        "call-123",
		"name":      "test_tool",
		"arguments": `{"input":"hello"}`,
	})
	paramsJSON, _ := json.Marshal(map[string]any{
		"type":    "ToolCallRequest",
		"payload": json.RawMessage(payloadJSON),
	})
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      toolReqID,
		Method:  "request",
		Params:  paramsJSON,
	})

	// Wait for and read SDK's response
	if scanner.Scan() {
		// Response received, continue
	}

	// Send TurnEnd event to properly end the turn
	sendEvent(encoder, "TurnEnd", map[string]any{})

	// Send prompt completion response
	encoder.Encode(Payload{
		Version: "2.0",
		ID:      reqID,
		Result:  json.RawMessage(`{"status":"finished","steps":1}`),
	})
}

