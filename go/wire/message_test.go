package wire

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Compile-time interface checks.
var (
	_ Message = TurnBegin{}
	_ Message = TurnEnd{}
	_ Message = StepBegin{}
	_ Message = StepInterrupted{}
	_ Message = CompactionBegin{}
	_ Message = CompactionEnd{}
	_ Message = StatusUpdate{}
	_ Message = ContentPart{}
	_ Message = ToolCallRequest{}
	_ Message = ToolCallPart{}
	_ Message = ToolResult{}
	_ Message = SubagentEvent{}
	_ Message = ApprovalRequestResolved{}
	_ Message = ApprovalResponse{}
	_ Message = ApprovalRequest{}

	_ Event = TurnBegin{}
	_ Event = TurnEnd{}
	_ Event = StepBegin{}
	_ Event = StepInterrupted{}
	_ Event = CompactionBegin{}
	_ Event = CompactionEnd{}
	_ Event = StatusUpdate{}
	_ Event = ContentPart{}
	_ Event = ToolCall{}
	_ Event = ToolCallPart{}
	_ Event = ToolResult{}
	_ Event = SubagentEvent{}
	_ Event = ApprovalRequestResolved{}
	_ Event = ApprovalResponse{}

	_ Request = ApprovalRequest{}
	_ Request = ToolCallRequest{}
)

func TestEvent_EventTypeConstants(t *testing.T) {
	cases := []struct {
		name string
		evt  Event
		want EventType
	}{
		{"TurnBegin", TurnBegin{}, EventTypeTurnBegin},
		{"TurnEnd", TurnEnd{}, EventTypeTurnEnd},
		{"StepBegin", StepBegin{}, EventTypeStepBegin},
		{"StepInterrupted", StepInterrupted{}, EventTypeStepInterrupted},
		{"CompactionBegin", CompactionBegin{}, EventTypeCompactionBegin},
		{"CompactionEnd", CompactionEnd{}, EventTypeCompactionEnd},
		{"StatusUpdate", StatusUpdate{}, EventTypeStatusUpdate},
		{"ContentPart", ContentPart{}, EventTypeContentPart},
		{"ToolCall", ToolCall{}, EventTypeToolCall},
		{"ToolCallPart", ToolCallPart{}, EventTypeToolCallPart},
		{"ToolResult", ToolResult{}, EventTypeToolResult},
		{"SubagentEvent", SubagentEvent{}, EventTypeSubagentEvent},
		{"ApprovalRequestResolved", ApprovalRequestResolved{}, EventTypeApprovalRequestResolved},
		{"ApprovalResponse", ApprovalResponse{}, EventTypeApprovalResponse},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.evt.EventType(); got != tc.want {
				t.Fatalf("EventType()=%q, want %q", got, tc.want)
			}
		})
	}
}

func TestContent_JSONRoundTrip_Text(t *testing.T) {
	in := NewStringContent("hello")
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(b) != "\"hello\"" {
		t.Fatalf("unexpected JSON: %s", string(b))
	}

	var out Content
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if out.Type != ContentTypeText {
		t.Fatalf("Type=%q, want %q", out.Type, ContentTypeText)
	}
	if out.Text.Value != "hello" {
		t.Fatalf("Text=%q, want %q", out.Text.Value, "hello")
	}
}

func TestContent_JSONRoundTrip_ContentParts(t *testing.T) {
	in := NewContent(NewTextContentPart("hi"))
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if len(b) == 0 || b[0] != '[' {
		t.Fatalf("expected JSON array, got: %s", string(b))
	}

	var out Content
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if out.Type != ContentTypeContentParts {
		t.Fatalf("Type=%q, want %q", out.Type, ContentTypeContentParts)
	}
	if len(out.ContentParts.Value) != 1 || out.ContentParts.Value[0].Text.Value != "hi" || out.ContentParts.Value[0].Type != ContentPartTypeText {
		t.Fatalf("unexpected ContentParts: %+v", out.ContentParts)
	}
}

func TestContent_MarshalJSON_InvalidType(t *testing.T) {
	in := Content{Type: ContentType("bad")}
	_, err := json.Marshal(in)
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestContent_UnmarshalJSON_InvalidToken(t *testing.T) {
	var c Content
	if err := json.Unmarshal([]byte(`{"k":1}`), &c); err == nil {
		t.Fatalf("expected error")
	}
}

func TestOptional_JSON(t *testing.T) {
	o := Optional[int]{}
	b, err := json.Marshal(o)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(b) != "null" {
		t.Fatalf("expected null, got %s", string(b))
	}

	var o2 Optional[int]
	if err := json.Unmarshal([]byte("123"), &o2); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !o2.Valid || o2.Value != 123 {
		t.Fatalf("unexpected Optional: %+v", o2)
	}

	var o3 Optional[int]
	if err := json.Unmarshal([]byte(" null "), &o3); err != nil {
		t.Fatalf("Unmarshal null: %v", err)
	}
	if o3.Valid {
		t.Fatalf("expected Valid=false")
	}
}

type badResponderFunc func(RequestResponse) error

func (f badResponderFunc) Respond(r RequestResponse) error {
	return f(r)
}

func TestPromptResult_UnmarshalJSON_WithSteps(t *testing.T) {
	var pr PromptResult
	if err := json.Unmarshal([]byte(`{"status":"finished","steps":3}`), &pr); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if pr.Status != PromptResultStatusFinished {
		t.Fatalf("Status=%q, want %q", pr.Status, PromptResultStatusFinished)
	}
	if !pr.Steps.Valid || pr.Steps.Value != 3 {
		t.Fatalf("unexpected Steps: %+v", pr.Steps)
	}
}

func TestPromptResult_UnmarshalJSON_NullSteps(t *testing.T) {
	var pr PromptResult
	if err := json.Unmarshal([]byte(`{"status":"pending","steps":null}`), &pr); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if pr.Status != PromptResultStatusPending {
		t.Fatalf("Status=%q, want %q", pr.Status, PromptResultStatusPending)
	}
	if pr.Steps.Valid {
		t.Fatalf("expected Steps.Valid=false, got %+v", pr.Steps)
	}
}

func TestApprovalRequest_MarshalJSON_IgnoresResponder(t *testing.T) {
	ar := ApprovalRequest{
		Responder:   badResponderFunc(func(RequestResponse) error { return nil }),
		ID:          "rid",
		ToolCallID:  "tcid",
		Sender:      "sender",
		Action:      "action",
		Description: "desc",
	}
	b, err := json.Marshal(ar)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, ok := m["Responder"]; ok {
		t.Fatalf("expected Responder to be omitted")
	}
	if _, ok := m["responder"]; ok {
		t.Fatalf("expected responder to be omitted")
	}
	if got := m["id"]; got != "rid" {
		t.Fatalf("id=%v, want %q", got, "rid")
	}
}

func TestEventParams_UnmarshalJSON_AllEventTypes(t *testing.T) {
	turn := TurnBegin{UserInput: NewStringContent("hi")}
	sub := SubagentEvent{
		TaskToolCallID: "ttc",
		Event: EventParams{
			Type:    EventTypeTurnBegin,
			Payload: turn,
		},
	}

	cases := []struct {
		name    string
		typeVal EventType
		payload Event
	}{
		{"TurnBegin", EventTypeTurnBegin, turn},
		{"TurnEnd", EventTypeTurnEnd, TurnEnd{}},
		{"StepBegin", EventTypeStepBegin, StepBegin{N: 1}},
		{"StepInterrupted", EventTypeStepInterrupted, StepInterrupted{}},
		{"CompactionBegin", EventTypeCompactionBegin, CompactionBegin{}},
		{"CompactionEnd", EventTypeCompactionEnd, CompactionEnd{}},
		{"StatusUpdate", EventTypeStatusUpdate, StatusUpdate{ContextUsage: Optional[float64]{Value: 0.5, Valid: true}}},
		{"ContentPart", EventTypeContentPart, NewTextContentPart("hello")},
		{"ToolCall", EventTypeToolCall, ToolCall{Type: "function", ID: "1", Function: ToolCallFunction{Name: "f"}}},
		{"ToolCallPart", EventTypeToolCallPart, ToolCallPart{ArgumentsPart: Optional[string]{Value: "x", Valid: true}}},
		{"ToolResult", EventTypeToolResult, ToolResult{ToolCallID: "1", ReturnValue: ToolResultReturnValue{IsError: false, Output: NewStringContent("ok"), Message: "m"}}},
		{"SubagentEvent", EventTypeSubagentEvent, sub},
		{"ApprovalRequestResolved", EventTypeApprovalRequestResolved, ApprovalRequestResolved{RequestID: "rid", Response: ApprovalRequestResponseApprove}},
		{"ApprovalResponse", EventTypeApprovalResponse, ApprovalResponse{RequestID: "rid", Response: ApprovalRequestResponseApprove}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, err := json.Marshal(map[string]any{
				"type":    tc.typeVal,
				"payload": tc.payload,
			})
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}

			var got EventParams
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			if got.Type != tc.typeVal {
				t.Fatalf("Type=%q, want %q", got.Type, tc.typeVal)
			}
			if got.Payload == nil {
				t.Fatalf("Payload is nil")
			}
			if got.Payload.EventType() != tc.typeVal {
				t.Fatalf("Payload.EventType()=%q, want %q", got.Payload.EventType(), tc.typeVal)
			}
			if !reflect.DeepEqual(got.Payload, tc.payload) {
				t.Fatalf("payload mismatch\n got: %#v\nwant: %#v", got.Payload, tc.payload)
			}
		})
	}
}

func TestEventParams_UnmarshalJSON_UnknownTypeReturnsError(t *testing.T) {
	var p EventParams
	err := json.Unmarshal([]byte(`{"type":"DoesNotExist","payload":{}}`), &p)
	if err == nil {
		t.Fatalf("expected error for unknown event type")
	}
}

func TestRequestParams_UnmarshalJSON_ApprovalRequest(t *testing.T) {
	payload := ApprovalRequest{
		ID:          "rid",
		ToolCallID:  "tcid",
		Sender:      "sender",
		Action:      "action",
		Description: "desc",
	}
	b, err := json.Marshal(map[string]any{
		"type":    RequestTypeApprovalRequest,
		"payload": payload,
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got RequestParams
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Type != RequestTypeApprovalRequest {
		t.Fatalf("Type=%q, want %q", got.Type, RequestTypeApprovalRequest)
	}
	ar, ok := got.Payload.(ApprovalRequest)
	if !ok {
		t.Fatalf("unexpected payload type: %T", got.Payload)
	}
	if ar.ID != "rid" {
		t.Fatalf("ID=%q, want %q", ar.ID, "rid")
	}
	if got.Payload.RequestType() != RequestTypeApprovalRequest {
		t.Fatalf("RequestType()=%q, want %q", got.Payload.RequestType(), RequestTypeApprovalRequest)
	}
}

func TestRequestParams_UnmarshalJSON_UnknownTypeReturnsError(t *testing.T) {
	var p RequestParams
	err := json.Unmarshal([]byte(`{"type":"DoesNotExist","payload":{}}`), &p)
	if err == nil {
		t.Fatalf("expected error for unknown request type")
	}
}
