package kimi

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// StringResult implements fmt.Stringer for test return values
type StringResult string

func (s StringResult) String() string {
	return string(s)
}

// JSONResult implements fmt.Stringer by marshaling to JSON
type JSONResult map[string]any

func (j JSONResult) String() string {
	data, _ := json.Marshal(j)
	return string(data)
}

type SearchParams struct {
	Query string `json:"query" description:"The search query"`
	Limit int    `json:"limit,omitempty" description:"Max results"`
}

func Search(params SearchParams) (JSONResult, error) {
	return JSONResult{"results": []string{params.Query}}, nil
}

func TestCreateTool_Basic(t *testing.T) {
	tool, err := CreateTool(Search)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	// Function name includes package path with '.' replaced by '_'
	if tool.def.Name == "" {
		t.Error("expected non-empty name")
	}
}

type namedReceiver struct{}

func (namedReceiver) Method(SearchParams) (string, error) { return "", nil }

func TestCreateTool_AutoNamePreservesFunctionName(t *testing.T) {
	// This module path (github.com/MoonshotAI/kimi-agent-sdk/go) contains
	// hyphens; the auto-derived name must not be truncated at the first one.
	tool, err := CreateTool(Search)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}
	if !strings.HasSuffix(tool.def.Name, "_Search") {
		t.Errorf("auto name %q should end with _Search (truncated at a path hyphen?)", tool.def.Name)
	}
}

func TestGetFunctionName_StripsMethodValueSuffix(t *testing.T) {
	var r namedReceiver
	// A method value's runtime name ends with "-fm"; that suffix (and only
	// that suffix) should be stripped, leaving the path/name intact.
	got := getFunctionName(r.Method)
	if strings.HasSuffix(got, "-fm") || strings.HasSuffix(got, "_fm") {
		t.Errorf("expected -fm suffix stripped, got %q", got)
	}
	if !strings.HasSuffix(got, "namedReceiver_Method") {
		t.Errorf("expected name to end with namedReceiver_Method, got %q", got)
	}
}

func TestCreateTool_WithOptions(t *testing.T) {
	tool, err := CreateTool(Search,
		WithName("custom_search"),
		WithDescription("A custom search tool"),
		WithFieldDescription("Query", "Custom query description"),
	)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	if tool.def.Name != "custom_search" {
		t.Errorf("expected name=custom_search, got %s", tool.def.Name)
	}
	if tool.def.Description != "A custom search tool" {
		t.Errorf("expected description='A custom search tool', got %s", tool.def.Description)
	}
}

func TestCreateTool_Schema(t *testing.T) {
	tool, err := CreateTool(Search)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(tool.def.Parameters, &schema); err != nil {
		t.Fatalf("failed to unmarshal schema: %v", err)
	}

	if schema["type"] != "object" {
		t.Errorf("expected type=object, got %v", schema["type"])
	}

	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties to be a map")
	}

	queryProp, ok := props["query"].(map[string]any)
	if !ok {
		t.Fatal("expected query property")
	}
	if queryProp["type"] != "string" {
		t.Errorf("expected query.type=string, got %v", queryProp["type"])
	}
	if queryProp["description"] != "The search query" {
		t.Errorf("expected query.description='The search query', got %v", queryProp["description"])
	}

	limitProp, ok := props["limit"].(map[string]any)
	if !ok {
		t.Fatal("expected limit property")
	}
	if limitProp["type"] != "integer" {
		t.Errorf("expected limit.type=integer, got %v", limitProp["type"])
	}

	required, ok := schema["required"].([]any)
	if !ok {
		t.Fatal("expected required to be an array")
	}
	// Only query should be required (limit has omitempty)
	if len(required) != 1 || required[0] != "query" {
		t.Errorf("expected required=[query], got %v", required)
	}
}

func TestCreateTool_Call(t *testing.T) {
	tool, err := CreateTool(Search)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	args := json.RawMessage(`{"query":"test","limit":10}`)
	result, err := tool.call(args)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}

	var res map[string]any
	if err := json.Unmarshal([]byte(result), &res); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	results, ok := res["results"].([]any)
	if !ok {
		t.Fatal("expected results to be an array")
	}
	if len(results) != 1 || results[0] != "test" {
		t.Errorf("expected results=[test], got %v", results)
	}
}

type NestedParams struct {
	User    UserInfo `json:"user"`
	Tags    []string `json:"tags,omitempty"`
	Options *Options `json:"options,omitempty"`
}

type UserInfo struct {
	Name string `json:"name"`
	Age  int    `json:"age"`
}

type Options struct {
	Debug bool `json:"debug"`
}

func ProcessNested(params NestedParams) (StringResult, error) {
	return StringResult(params.User.Name), nil
}

func TestCreateTool_NestedStruct(t *testing.T) {
	tool, err := CreateTool(ProcessNested)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(tool.def.Parameters, &schema); err != nil {
		t.Fatalf("failed to unmarshal schema: %v", err)
	}

	props := schema["properties"].(map[string]any)

	// Check nested user struct
	userProp := props["user"].(map[string]any)
	if userProp["type"] != "object" {
		t.Errorf("expected user.type=object, got %v", userProp["type"])
	}
	userProps := userProp["properties"].(map[string]any)
	if _, ok := userProps["name"]; !ok {
		t.Error("expected user to have name property")
	}
	if _, ok := userProps["age"]; !ok {
		t.Error("expected user to have age property")
	}

	// Check array type
	tagsProp := props["tags"].(map[string]any)
	if tagsProp["type"] != "array" {
		t.Errorf("expected tags.type=array, got %v", tagsProp["type"])
	}
	tagsItems := tagsProp["items"].(map[string]any)
	if tagsItems["type"] != "string" {
		t.Errorf("expected tags.items.type=string, got %v", tagsItems["type"])
	}

	// Check pointer type (should be object)
	optionsProp := props["options"].(map[string]any)
	if optionsProp["type"] != "object" {
		t.Errorf("expected options.type=object, got %v", optionsProp["type"])
	}

	// Check required - user should be required, tags and options should not
	required := schema["required"].([]any)
	if len(required) != 1 || required[0] != "user" {
		t.Errorf("expected required=[user], got %v", required)
	}
}

func TestCreateTool_WithFieldDescriptionOverride(t *testing.T) {
	tool, err := CreateTool(Search,
		WithFieldDescription("Query", "Overridden description"),
	)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(tool.def.Parameters, &schema); err != nil {
		t.Fatalf("failed to unmarshal schema: %v", err)
	}

	props := schema["properties"].(map[string]any)
	queryProp := props["query"].(map[string]any)

	// WithFieldDescription should override struct tag
	if queryProp["description"] != "Overridden description" {
		t.Errorf("expected description='Overridden description', got %v", queryProp["description"])
	}
}

type AllTypesParams struct {
	BoolField    bool    `json:"bool_field"`
	IntField     int     `json:"int_field"`
	Int64Field   int64   `json:"int64_field"`
	Float32Field float32 `json:"float32_field"`
	Float64Field float64 `json:"float64_field"`
	StringField  string  `json:"string_field"`
}

func ProcessAllTypes(params AllTypesParams) (StringResult, error) {
	return StringResult("ok"), nil
}

func TestCreateTool_AllTypes(t *testing.T) {
	tool, err := CreateTool(ProcessAllTypes)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(tool.def.Parameters, &schema); err != nil {
		t.Fatalf("failed to unmarshal schema: %v", err)
	}

	props := schema["properties"].(map[string]any)

	tests := []struct {
		field    string
		expected string
	}{
		{"bool_field", "boolean"},
		{"int_field", "integer"},
		{"int64_field", "integer"},
		{"float32_field", "number"},
		{"float64_field", "number"},
		{"string_field", "string"},
	}

	for _, tt := range tests {
		prop := props[tt.field].(map[string]any)
		if prop["type"] != tt.expected {
			t.Errorf("expected %s.type=%s, got %v", tt.field, tt.expected, prop["type"])
		}
	}
}

func TestWithName(t *testing.T) {
	opt := &toolOption{}
	WithName("test_name")(opt)

	if opt.name != "test_name" {
		t.Errorf("expected name=test_name, got %s", opt.name)
	}
}

func TestWithDescription(t *testing.T) {
	opt := &toolOption{}
	WithDescription("test description")(opt)

	if opt.description != "test description" {
		t.Errorf("expected description='test description', got %s", opt.description)
	}
}

func TestWithFieldDescription(t *testing.T) {
	opt := &toolOption{}
	WithFieldDescription("Field1", "desc1")(opt)
	WithFieldDescription("Field2", "desc2")(opt)

	expected := map[string]string{
		"Field1": "desc1",
		"Field2": "desc2",
	}
	if !reflect.DeepEqual(opt.fieldDescriptions, expected) {
		t.Errorf("expected fieldDescriptions=%v, got %v", expected, opt.fieldDescriptions)
	}
}

type UnsupportedParams struct {
	Callback func() `json:"callback"`
}

func ProcessUnsupported(params UnsupportedParams) (StringResult, error) {
	return "", nil
}

func TestCreateTool_UnsupportedType(t *testing.T) {
	_, err := CreateTool(ProcessUnsupported)
	if err == nil {
		t.Error("expected error for unsupported type, got nil")
	}
}

type InterfaceParams struct {
	Data any `json:"data"`
}

func ProcessInterface(params InterfaceParams) (StringResult, error) {
	return "", nil
}

func TestCreateTool_InterfaceType(t *testing.T) {
	_, err := CreateTool(ProcessInterface)
	if err == nil {
		t.Error("expected error for interface type, got nil")
	}
}

func ProcessString(params string) (StringResult, error) {
	return StringResult(params), nil
}

func TestCreateTool_NonStructParam(t *testing.T) {
	_, err := CreateTool(ProcessString)
	if err == nil {
		t.Error("expected error for non-struct parameter, got nil")
	}
}

// Test stringifyResult with different return types

type SimpleArgs struct {
	Input string `json:"input"`
}

// Test 1: string return type
func ReturnString(args SimpleArgs) (string, error) {
	return "direct string: " + args.Input, nil
}

func TestCreateTool_ReturnString(t *testing.T) {
	tool, err := CreateTool(ReturnString)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	result, err := tool.call(json.RawMessage(`{"input":"test"}`))
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}

	expected := "direct string: test"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

// Test 2: fmt.Stringer return type (already covered by existing tests, but explicit)
func ReturnStringer(args SimpleArgs) (StringResult, error) {
	return StringResult("stringer: " + args.Input), nil
}

func TestCreateTool_ReturnStringer(t *testing.T) {
	tool, err := CreateTool(ReturnStringer)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	result, err := tool.call(json.RawMessage(`{"input":"test"}`))
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}

	expected := "stringer: test"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

// Test 3: struct return type (JSON serialized)
type StructResult struct {
	Output string `json:"output"`
	Count  int    `json:"count"`
}

func ReturnStruct(args SimpleArgs) (StructResult, error) {
	return StructResult{Output: args.Input, Count: len(args.Input)}, nil
}

func TestCreateTool_ReturnStruct(t *testing.T) {
	tool, err := CreateTool(ReturnStruct)
	if err != nil {
		t.Fatalf("CreateTool failed: %v", err)
	}

	result, err := tool.call(json.RawMessage(`{"input":"hello"}`))
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}

	var res StructResult
	if err := json.Unmarshal([]byte(result), &res); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	if res.Output != "hello" {
		t.Errorf("expected output=hello, got %s", res.Output)
	}
	if res.Count != 5 {
		t.Errorf("expected count=5, got %d", res.Count)
	}
}

// ============================================================================
// generateSchema tests - direct JSON schema string comparison
// ============================================================================

// mustMarshalSchema is a test helper that generates schema and marshals to JSON.
func mustMarshalSchema(t *testing.T, typ reflect.Type, fieldDescs map[string]string) string {
	t.Helper()
	schema, err := generateSchema(typ, fieldDescs)
	if err != nil {
		t.Fatalf("generateSchema failed: %v", err)
	}
	got, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	return string(got)
}

func TestGenerateSchema_PrimitiveTypes(t *testing.T) {
	tests := []struct {
		name     string
		typ      reflect.Type
		expected string
	}{
		{"bool", reflect.TypeFor[bool](), `{"type":"boolean"}`},
		{"int", reflect.TypeFor[int](), `{"type":"integer"}`},
		{"int8", reflect.TypeFor[int8](), `{"type":"integer"}`},
		{"int16", reflect.TypeFor[int16](), `{"type":"integer"}`},
		{"int32", reflect.TypeFor[int32](), `{"type":"integer"}`},
		{"int64", reflect.TypeFor[int64](), `{"type":"integer"}`},
		{"uint", reflect.TypeFor[uint](), `{"type":"integer"}`},
		{"uint8", reflect.TypeFor[uint8](), `{"type":"integer"}`},
		{"uint16", reflect.TypeFor[uint16](), `{"type":"integer"}`},
		{"uint32", reflect.TypeFor[uint32](), `{"type":"integer"}`},
		{"uint64", reflect.TypeFor[uint64](), `{"type":"integer"}`},
		{"float32", reflect.TypeFor[float32](), `{"type":"number"}`},
		{"float64", reflect.TypeFor[float64](), `{"type":"number"}`},
		{"string", reflect.TypeFor[string](), `{"type":"string"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mustMarshalSchema(t, tt.typ, nil)
			if got != tt.expected {
				t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, tt.expected)
			}
		})
	}
}

func TestGenerateSchema_EmptyStruct(t *testing.T) {
	type EmptyStruct struct{}

	got := mustMarshalSchema(t, reflect.TypeFor[EmptyStruct](), nil)
	expected := `{"type":"object"}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_UnexportedFields(t *testing.T) {
	type StructWithUnexported struct {
		Public  string `json:"public"`
		private string //nolint:unused
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithUnexported](), nil)
	expected := `{"type":"object","properties":{"public":{"type":"string"}},"required":["public"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_JsonIgnoreTag(t *testing.T) {
	type StructWithIgnored struct {
		Visible string `json:"visible"`
		Ignored string `json:"-"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithIgnored](), nil)
	expected := `{"type":"object","properties":{"visible":{"type":"string"}},"required":["visible"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_OmitemptyTag(t *testing.T) {
	type StructWithOmitempty struct {
		Required string `json:"required"`
		Optional string `json:"optional,omitempty"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithOmitempty](), nil)
	expected := `{"type":"object","properties":{"optional":{"type":"string"},"required":{"type":"string"}},"required":["required"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_OmitzeroTag(t *testing.T) {
	type StructWithOmitzero struct {
		Required string `json:"required"`
		Optional string `json:"optional,omitzero"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithOmitzero](), nil)
	expected := `{"type":"object","properties":{"optional":{"type":"string"},"required":{"type":"string"}},"required":["required"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_EmptyJsonName(t *testing.T) {
	type StructWithEmptyJsonName struct {
		FieldName string `json:""`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithEmptyJsonName](), nil)
	expected := `{"type":"object","properties":{"FieldName":{"type":"string"}},"required":["FieldName"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_DescriptionTag(t *testing.T) {
	type StructWithDescription struct {
		Field string `json:"field" description:"A field description"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithDescription](), nil)
	expected := `{"type":"object","properties":{"field":{"type":"string","description":"A field description"}},"required":["field"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_Slice(t *testing.T) {
	got := mustMarshalSchema(t, reflect.TypeFor[[]string](), nil)
	expected := `{"type":"array","items":{"type":"string"}}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_Array(t *testing.T) {
	got := mustMarshalSchema(t, reflect.TypeFor[[3]int](), nil)
	expected := `{"type":"array","items":{"type":"integer"}}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_Pointer(t *testing.T) {
	got := mustMarshalSchema(t, reflect.TypeFor[*string](), nil)
	expected := `{"type":"string"}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_PointerAlwaysOptional(t *testing.T) {
	type StructWithPointer struct {
		Required string  `json:"required"`
		Optional *string `json:"optional"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithPointer](), nil)
	expected := `{"type":"object","properties":{"optional":{"type":"string"},"required":{"type":"string"}},"required":["required"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_MapStringKey(t *testing.T) {
	got := mustMarshalSchema(t, reflect.TypeFor[map[string]int](), nil)
	expected := `{"type":"object"}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_MapNonStringKey(t *testing.T) {
	_, err := generateSchema(reflect.TypeFor[map[int]string](), nil)
	if err == nil {
		t.Error("expected error for map with non-string key, got nil")
	}
}

func TestGenerateSchema_NestedStruct(t *testing.T) {
	type Inner struct {
		Value string `json:"value"`
	}
	type Outer struct {
		Inner Inner `json:"inner"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[Outer](), nil)
	expected := `{"type":"object","properties":{"inner":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}},"required":["inner"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_DeepNested(t *testing.T) {
	type Level3 struct {
		Data string `json:"data"`
	}
	type Level2 struct {
		Level3 Level3 `json:"level3"`
	}
	type Level1 struct {
		Level2 Level2 `json:"level2"`
	}
	type Root struct {
		Level1 Level1 `json:"level1"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[Root](), nil)
	expected := `{"type":"object","properties":{"level1":{"type":"object","properties":{"level2":{"type":"object","properties":{"level3":{"type":"object","properties":{"data":{"type":"string"}},"required":["data"]}},"required":["level3"]}},"required":["level2"]}},"required":["level1"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_SliceOfStructs(t *testing.T) {
	type Item struct {
		Name string `json:"name"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[[]Item](), nil)
	expected := `{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_UnsupportedTypes(t *testing.T) {
	tests := []struct {
		name string
		typ  reflect.Type
	}{
		{"interface", reflect.TypeFor[any]()},
		{"func", reflect.TypeFor[func()]()},
		{"chan", reflect.TypeFor[chan int]()},
		{"complex64", reflect.TypeFor[complex64]()},
		{"complex128", reflect.TypeFor[complex128]()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := generateSchema(tt.typ, nil)
			if err == nil {
				t.Errorf("expected error for unsupported type %s, got nil", tt.name)
			}
		})
	}
}

func TestGenerateSchema_FieldDescsOverride(t *testing.T) {
	type StructWithDesc struct {
		Field string `json:"field" description:"original"`
	}

	fieldDescs := map[string]string{
		"Field": "overridden",
	}

	got := mustMarshalSchema(t, reflect.TypeFor[StructWithDesc](), fieldDescs)
	expected := `{"type":"object","properties":{"field":{"type":"string","description":"overridden"}},"required":["field"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_FieldDescsNotPassedToNested(t *testing.T) {
	type Inner struct {
		Value string `json:"value" description:"inner desc"`
	}
	type Outer struct {
		Inner Inner `json:"inner"`
	}

	fieldDescs := map[string]string{
		"Value": "should not apply to nested",
	}

	got := mustMarshalSchema(t, reflect.TypeFor[Outer](), fieldDescs)
	// Inner.Value should keep "inner desc" since fieldDescs is not passed to nested
	expected := `{"type":"object","properties":{"inner":{"type":"object","properties":{"value":{"type":"string","description":"inner desc"}},"required":["value"]}},"required":["inner"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}

func TestGenerateSchema_ComplexStruct(t *testing.T) {
	type Address struct {
		City string `json:"city"`
	}
	type Person struct {
		Name     string         `json:"name" description:"Person's name"`
		Age      int            `json:"age,omitempty"`
		Tags     []string       `json:"tags,omitempty"`
		Address  *Address       `json:"address,omitempty"`
		Metadata map[string]any `json:"-"`
	}

	got := mustMarshalSchema(t, reflect.TypeFor[Person](), nil)
	expected := `{"type":"object","properties":{"address":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]},"age":{"type":"integer"},"name":{"type":"string","description":"Person's name"},"tags":{"type":"array","items":{"type":"string"}}},"required":["name"]}`

	if got != expected {
		t.Errorf("schema mismatch:\ngot:  %s\nwant: %s", got, expected)
	}
}
