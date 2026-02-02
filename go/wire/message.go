package wire

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type (
	InitializeParams struct {
		ProtocolVersion string               `json:"protocol_version"`
		Client          Optional[ClientInfo] `json:"client,omitzero"`
		ExternalTools   []ExternalTool       `json:"external_tools,omitempty"`
	}
	InitializeResult struct {
		ProtocolVersion string                        `json:"protocol_version"`
		Server          ServerInfo                    `json:"server"`
		SlashCommands   []SlashCommand                `json:"slash_commands"`
		ExternalTools   Optional[ExternalToolsResult] `json:"external_tools,omitzero"`
	}
	ClientInfo struct {
		Name    string `json:"name"`
		Version string `json:"version,omitempty"`
	}
	ServerInfo struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	SlashCommand struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Aliases     []string `json:"aliases"`
	}
	ExternalToolsResult struct {
		Accepted []string               `json:"accepted"`
		Rejected []RejectedExternalTool `json:"rejected"`
	}
	RejectedExternalTool struct {
		Name   string `json:"name"`
		Reason string `json:"reason"`
	}
	PromptParams struct {
		UserInput Content `json:"user_input"`
	}
	PromptResult struct {
		Status PromptResultStatus `json:"status"`
		Steps  Optional[int]      `json:"steps"`
	}
	CancelParams struct{}
	CancelResult struct{}
	EventParams  struct {
		Type    EventType `json:"type"`
		Payload Event     `json:"payload"`
	}
	EventResult   struct{}
	RequestParams struct {
		Type    RequestType `json:"type"`
		Payload Request     `json:"payload"`
	}
	// RequestResult is an alias for RequestResponse, used as RPC return value
	RequestResult = RequestResponse
)

type Message interface {
	message()
}

func (TurnBegin) message()               {}
func (TurnEnd) message()                 {}
func (StepBegin) message()               {}
func (StepInterrupted) message()         {}
func (CompactionBegin) message()         {}
func (CompactionEnd) message()           {}
func (StatusUpdate) message()            {}
func (ContentPart) message()             {}
func (ToolCall) message()                {}
func (ToolCallPart) message()            {}
func (ToolResult) message()              {}
func (SubagentEvent) message()           {}
func (ApprovalRequestResolved) message() {}
func (ApprovalResponse) message()        {}
func (ApprovalRequest) message()         {}
func (ToolCallRequest) message()         {}

type Event interface {
	Message
	EventType() EventType
}

type EventType string

const (
	EventTypeTurnBegin               EventType = "TurnBegin"
	EventTypeTurnEnd                 EventType = "TurnEnd"
	EventTypeStepBegin               EventType = "StepBegin"
	EventTypeStepInterrupted         EventType = "StepInterrupted"
	EventTypeCompactionBegin         EventType = "CompactionBegin"
	EventTypeCompactionEnd           EventType = "CompactionEnd"
	EventTypeStatusUpdate            EventType = "StatusUpdate"
	EventTypeContentPart             EventType = "ContentPart"
	EventTypeToolCall                EventType = "ToolCall"
	EventTypeToolCallPart            EventType = "ToolCallPart"
	EventTypeToolResult              EventType = "ToolResult"
	EventTypeSubagentEvent           EventType = "SubagentEvent"
	EventTypeApprovalRequestResolved EventType = "ApprovalRequestResolved"
	EventTypeApprovalResponse        EventType = "ApprovalResponse"
)

func (TurnBegin) EventType() EventType               { return EventTypeTurnBegin }
func (TurnEnd) EventType() EventType                 { return EventTypeTurnEnd }
func (StepBegin) EventType() EventType               { return EventTypeStepBegin }
func (StepInterrupted) EventType() EventType         { return EventTypeStepInterrupted }
func (CompactionBegin) EventType() EventType         { return EventTypeCompactionBegin }
func (CompactionEnd) EventType() EventType           { return EventTypeCompactionEnd }
func (StatusUpdate) EventType() EventType            { return EventTypeStatusUpdate }
func (ContentPart) EventType() EventType             { return EventTypeContentPart }
func (ToolCall) EventType() EventType                { return EventTypeToolCall }
func (ToolCallPart) EventType() EventType            { return EventTypeToolCallPart }
func (ToolResult) EventType() EventType              { return EventTypeToolResult }
func (SubagentEvent) EventType() EventType           { return EventTypeSubagentEvent }
func (ApprovalRequestResolved) EventType() EventType { return EventTypeApprovalRequestResolved }
func (ApprovalResponse) EventType() EventType        { return EventTypeApprovalResponse }

func unmarshalEvent[E Event](data []byte) (Event, error) {
	var event E
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, err
	}
	return event, nil
}

var eventUnmarshaler = map[EventType]func(data []byte) (Event, error){
	EventTypeTurnBegin:               unmarshalEvent[TurnBegin],
	EventTypeTurnEnd:                 unmarshalEvent[TurnEnd],
	EventTypeStepBegin:               unmarshalEvent[StepBegin],
	EventTypeStepInterrupted:         unmarshalEvent[StepInterrupted],
	EventTypeCompactionBegin:         unmarshalEvent[CompactionBegin],
	EventTypeCompactionEnd:           unmarshalEvent[CompactionEnd],
	EventTypeStatusUpdate:            unmarshalEvent[StatusUpdate],
	EventTypeContentPart:             unmarshalEvent[ContentPart],
	EventTypeToolCall:                unmarshalEvent[ToolCall],
	EventTypeToolCallPart:            unmarshalEvent[ToolCallPart],
	EventTypeToolResult:              unmarshalEvent[ToolResult],
	EventTypeSubagentEvent:           unmarshalEvent[SubagentEvent],
	EventTypeApprovalRequestResolved: unmarshalEvent[ApprovalRequestResolved],
	EventTypeApprovalResponse:        unmarshalEvent[ApprovalResponse],
}

func (params *EventParams) UnmarshalJSON(data []byte) (err error) {
	var discriminator struct {
		Type    EventType       `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &discriminator); err != nil {
		return err
	}
	unmarshaler, ok := eventUnmarshaler[discriminator.Type]
	if !ok {
		return fmt.Errorf("unknown event type: %q", discriminator.Type)
	}
	if params.Payload, err = unmarshaler(discriminator.Payload); err != nil {
		return err
	}
	params.Type = discriminator.Type
	return nil
}

type Request interface {
	Message
	RequestType() RequestType
	Responder
}

type RequestResponse interface {
	requestResponse()
}

func (ApprovalResponse) requestResponse() {}
func (ToolResult) requestResponse()       {}

type Responder interface {
	Respond(RequestResponse) error
}

type RequestType string

const (
	RequestTypeApprovalRequest RequestType = "ApprovalRequest"
	RequestTypeToolCallRequest RequestType = "ToolCallRequest"
)

func (r ApprovalRequest) RequestType() RequestType { return RequestTypeApprovalRequest }
func (r ToolCallRequest) RequestType() RequestType { return RequestTypeToolCallRequest }

func (ApprovalRequestResponse) requestResponse() {}

func unmarshalRequest[R Request](data []byte) (Request, error) {
	var request R
	if err := json.Unmarshal(data, &request); err != nil {
		return nil, err
	}
	return request, nil
}

var requestUnmarshaler = map[RequestType]func(data []byte) (Request, error){
	RequestTypeApprovalRequest: unmarshalRequest[ApprovalRequest],
	RequestTypeToolCallRequest: unmarshalRequest[ToolCallRequest],
}

func (params *RequestParams) UnmarshalJSON(data []byte) (err error) {
	var discriminator struct {
		Type    RequestType     `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &discriminator); err != nil {
		return err
	}
	unmarshaler, ok := requestUnmarshaler[discriminator.Type]
	if !ok {
		return fmt.Errorf("unknown request type: %q", discriminator.Type)
	}
	if params.Payload, err = unmarshaler(discriminator.Payload); err != nil {
		return err
	}
	params.Type = discriminator.Type
	return nil
}

type PromptResultStatus string

var (
	PromptResultStatusPending         PromptResultStatus = "pending"
	PromptResultStatusFinished        PromptResultStatus = "finished"
	PromptResultStatusCancelled       PromptResultStatus = "cancelled"
	PromptResultStatusMaxStepsReached PromptResultStatus = "max_steps_reached"
	PromptResultStatusUnexpectedEOF   PromptResultStatus = "unexpected_eof"
)

func NewContent(contentParts ...ContentPart) Content {
	return Content{
		Type:         ContentTypeContentParts,
		ContentParts: Optional[[]ContentPart]{Value: contentParts, Valid: true},
	}
}

func NewTextContentPart(text string) ContentPart {
	return ContentPart{
		Type: ContentPartTypeText,
		Text: Optional[string]{Value: text, Valid: true},
	}
}

func NewImageContentPart(url string) ContentPart {
	return ContentPart{
		Type:     ContentPartTypeImageURL,
		ImageURL: Optional[MediaURL]{Value: MediaURL{URL: url}, Valid: true},
	}
}

func NewAudioContentPart(url string) ContentPart {
	return ContentPart{
		Type:     ContentPartTypeAudioURL,
		AudioURL: Optional[MediaURL]{Value: MediaURL{URL: url}, Valid: true},
	}
}

func NewVideoContentPart(url string) ContentPart {
	return ContentPart{
		Type:     ContentPartTypeVideoURL,
		VideoURL: Optional[MediaURL]{Value: MediaURL{URL: url}, Valid: true},
	}
}

func NewStringContent(text string) Content {
	return Content{
		Type: ContentTypeText,
		Text: Optional[string]{Value: text, Valid: true},
	}
}

type ContentType string

const (
	ContentTypeText         ContentType = "text"
	ContentTypeContentParts ContentType = "content_parts"
)

type Content struct {
	Type         ContentType
	Text         Optional[string]
	ContentParts Optional[[]ContentPart]
}

func (c Content) MarshalJSON() ([]byte, error) {
	switch c.Type {
	case ContentTypeText:
		return json.Marshal(c.Text)
	case ContentTypeContentParts:
		return json.Marshal(c.ContentParts)
	default:
		return nil, fmt.Errorf("invalid content type: %q, expected one of %q or %q", c.Type, ContentTypeText, ContentTypeContentParts)
	}
}

func (c *Content) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	switch data[0] {
	case '"':
		if err := json.Unmarshal(data, &c.Text); err != nil {
			return err
		}
		c.Type = ContentTypeText
	case '[':
		if err := json.Unmarshal(data, &c.ContentParts); err != nil {
			return err
		}
		c.Type = ContentTypeContentParts
	default:
		return fmt.Errorf("invalid content type, expected one of %q or %q", ContentTypeText, ContentTypeContentParts)
	}
	return nil
}

type TurnBegin struct {
	UserInput Content `json:"user_input"`
}

type TurnEnd struct{}

type StepBegin struct {
	N int `json:"n"`
}

type (
	StepInterrupted struct{}
	CompactionBegin struct{}
	CompactionEnd   struct{}
)

type StatusUpdate struct {
	ContextUsage Optional[float64]    `json:"context_usage,omitzero"`
	TokenUsage   Optional[TokenUsage] `json:"token_usage,omitzero"`
	MessageID    Optional[string]     `json:"message_id,omitzero"`
}

type TokenUsage struct {
	InputOther         int `json:"input_other"`
	Output             int `json:"output"`
	InputCacheRead     int `json:"input_cache_read"`
	InputCacheCreation int `json:"input_cache_creation"`
}

type ContentPartType string

const (
	ContentPartTypeText     ContentPartType = "text"
	ContentPartTypeThink    ContentPartType = "think"
	ContentPartTypeImageURL ContentPartType = "image_url"
	ContentPartTypeAudioURL ContentPartType = "audio_url"
	ContentPartTypeVideoURL ContentPartType = "video_url"
)

type ContentPart struct {
	Type      ContentPartType    `json:"type"`
	Text      Optional[string]   `json:"text,omitzero"`
	Think     Optional[string]   `json:"think,omitzero"`
	Encrypted Optional[string]   `json:"encrypted,omitzero"`
	ImageURL  Optional[MediaURL] `json:"image_url,omitzero"`
	AudioURL  Optional[MediaURL] `json:"audio_url,omitzero"`
	VideoURL  Optional[MediaURL] `json:"video_url,omitzero"`
}

type MediaURL struct {
	ID  Optional[string] `json:"id,omitzero"`
	URL string           `json:"url"`
}

type ToolCallType string

const (
	ToolCallTypeFunction ToolCallType = "function"
)

type ToolCall struct {
	Type     ToolCallType             `json:"type"`
	ID       string                   `json:"id"`
	Function ToolCallFunction         `json:"function"`
	Extras   Optional[map[string]any] `json:"extras,omitzero"`
}

type ToolCallFunction struct {
	Name      string           `json:"name"`
	Arguments Optional[string] `json:"arguments,omitzero"`
}

type ToolCallPart struct {
	ArgumentsPart Optional[string] `json:"arguments_part,omitzero"`
}

type ToolResult struct {
	ToolCallID  string                `json:"tool_call_id"`
	ReturnValue ToolResultReturnValue `json:"return_value"`
}

type ToolResultReturnValue struct {
	IsError bool                     `json:"is_error"`
	Output  Content                  `json:"output"`
	Message string                   `json:"message"`
	Display []DisplayBlock           `json:"display"`
	Extras  Optional[map[string]any] `json:"extras,omitzero"`
}

type SubagentEvent struct {
	TaskToolCallID string      `json:"task_tool_call_id"`
	Event          EventParams `json:"event"`
}

// Deprecated: Renamed to ApprovalResponse in Wire 1.1.
// The old name is still accepted for backwards compatibility.
type ApprovalRequestResolved struct {
	RequestID string                  `json:"request_id"`
	Response  ApprovalRequestResponse `json:"response"`
}

type ApprovalRequest struct {
	Responder   `json:"-"`
	ID          string         `json:"id"`
	ToolCallID  string         `json:"tool_call_id"`
	Sender      string         `json:"sender"`
	Action      string         `json:"action"`
	Description string         `json:"description"`
	Display     []DisplayBlock `json:"display,omitzero"`
}

type ApprovalRequestResponse string

const (
	ApprovalRequestResponseApprove           ApprovalRequestResponse = "approve"
	ApprovalRequestResponseApproveForSession ApprovalRequestResponse = "approve_for_session"
	ApprovalRequestResponseReject            ApprovalRequestResponse = "reject"
)

// ApprovalResponse is the response to an ApprovalRequest
type ApprovalResponse struct {
	RequestID string                  `json:"request_id"`
	Response  ApprovalRequestResponse `json:"response"`
}

type ToolCallRequest struct {
	Responder `json:"-"`
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Arguments Optional[string] `json:"arguments,omitzero"`
}

type DisplayBlockType string

const (
	DisplayBlockTypeBrief   DisplayBlockType = "brief"
	DisplayBlockTypeDiff    DisplayBlockType = "diff"
	DisplayBlockTypeTodo    DisplayBlockType = "todo"
	DisplayBlockTypeShell   DisplayBlockType = "shell"
	DisplayBlockTypeUnknown DisplayBlockType = "unknown"
)

type DisplayBlock struct {
	Type     DisplayBlockType                 `json:"type"`
	Text     Optional[string]                 `json:"text,omitzero"`
	Path     Optional[string]                 `json:"path,omitzero"`
	OldText  Optional[string]                 `json:"old_text,omitzero"`
	NewText  Optional[string]                 `json:"new_text,omitzero"`
	Items    Optional[[]DisplayBlockTodoItem] `json:"items,omitzero"`
	Data     Optional[DisplayBlockData]       `json:"data,omitzero"`
	Language Optional[string]                 `json:"language,omitzero"`
	Command  Optional[string]                 `json:"command,omitzero"`
}

type DisplayBlockDataType string

const (
	DisplayBlockDataTypeText   DisplayBlockDataType = "text"
	DisplayBlockDataTypeObject DisplayBlockDataType = "object"
)

type DisplayBlockData struct {
	Type   DisplayBlockDataType
	Text   Optional[string]
	Object Optional[map[string]any]
}

func (d DisplayBlockData) MarshalJSON() ([]byte, error) {
	switch d.Type {
	case DisplayBlockDataTypeText:
		return json.Marshal(d.Text)
	case DisplayBlockDataTypeObject:
		return json.Marshal(d.Object)
	default:
		return nil, fmt.Errorf("invalid display block data type: %q, expected one of %q or %q", d.Type, DisplayBlockDataTypeText, DisplayBlockDataTypeObject)
	}
}

func (d *DisplayBlockData) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	switch data[0] {
	case '"':
		if err := json.Unmarshal(data, &d.Text); err != nil {
			return err
		}
		d.Type = DisplayBlockDataTypeText
	case '{':
		if err := json.Unmarshal(data, &d.Object); err != nil {
			return err
		}
		d.Type = DisplayBlockDataTypeObject
	default:
		return fmt.Errorf("invalid display block data type, expected one of %q or %q", DisplayBlockDataTypeText, DisplayBlockDataTypeObject)
	}
	return nil
}

type TodoStatus string

const (
	TodoStatusPending    TodoStatus = "pending"
	TodoStatusInProgress TodoStatus = "in_progress"
	TodoStatusDone       TodoStatus = "done"
)

type DisplayBlockTodoItem struct {
	Title  string     `json:"title"`
	Status TodoStatus `json:"status"`
}

type ExternalTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type Optional[T any] struct {
	Value T
	Valid bool
}

func (o Optional[T]) MarshalJSON() ([]byte, error) {
	if !o.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

func (o *Optional[T]) UnmarshalJSON(data []byte) error {
	if string(bytes.TrimSpace(data)) == "null" {
		o.Valid = false
		return nil
	}
	if err := json.Unmarshal(data, &o.Value); err != nil {
		return err
	}
	o.Valid = true
	return nil
}
