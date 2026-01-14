package kimi

import (
	"encoding/json"
	"fmt"
	"reflect"
	"runtime"
	"strings"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

type Tool struct {
	call func(args json.RawMessage) (string, error)
	def  wire.ExternalTool
}

type ToolOption func(*toolOption)

type toolOption struct {
	name              string
	schema            json.RawMessage
	description       string
	fieldDescriptions map[string]string
}

// WithName sets the tool name (overrides auto-detected name from function).
func WithName(name string) ToolOption {
	return func(opt *toolOption) {
		opt.name = name
	}
}

// WithSchema sets the JSON schema directly, bypassing automatic schema generation from the parameter type.
// Use this when you need full control over the schema or when the automatic generation doesn't meet your needs.
func WithSchema(schema json.RawMessage) ToolOption {
	return func(opt *toolOption) {
		opt.schema = schema
	}
}

// WithDescription sets the tool description.
func WithDescription(description string) ToolOption {
	return func(opt *toolOption) {
		opt.description = description
	}
}

// WithFieldDescription sets description for a struct field.
// The fieldName should be the Go struct field name (not the JSON name).
func WithFieldDescription(fieldName, description string) ToolOption {
	return func(opt *toolOption) {
		if opt.fieldDescriptions == nil {
			opt.fieldDescriptions = make(map[string]string)
		}
		opt.fieldDescriptions[fieldName] = description
	}
}

// CreateTool creates a Tool from a function.
// The function must have signature func(T) (U, error) where T is a struct type.
// The result U can be: string (returned directly), fmt.Stringer (calls .String()), or any other type (JSON serialized).
func CreateTool[T any, U any](function func(T) (U, error), options ...ToolOption) (Tool, error) {
	opt := &toolOption{}
	for _, o := range options {
		if o != nil {
			o(opt)
		}
	}

	// Get function name
	name := opt.name
	if name == "" {
		name = getFunctionName(function)
	}
	if name == "" {
		return Tool{}, fmt.Errorf("unable to determine function name; use WithName() to set it explicitly")
	}

	// Get JSON schema: use provided schema or generate from parameter type
	var schemaJSON json.RawMessage
	if opt.schema != nil {
		schemaJSON = opt.schema
	} else {
		paramType := reflect.TypeFor[T]()
		// Parameter type must be struct or map[string]T (JSON schema must be object)
		switch paramType.Kind() {
		case reflect.Struct:
			// OK
		case reflect.Map:
			if paramType.Key().Kind() != reflect.String {
				return Tool{}, fmt.Errorf("map key must be string, got %s", paramType.Key().Kind())
			}
		default:
			return Tool{}, fmt.Errorf("parameter type must be struct or map, got %s", paramType.Kind())
		}
		schema, err := generateSchema(paramType, opt.fieldDescriptions)
		if err != nil {
			return Tool{}, fmt.Errorf("generate schema: %w", err)
		}
		schemaJSON, err = json.Marshal(schema)
		if err != nil {
			return Tool{}, err
		}
	}

	def := wire.ExternalTool{
		Type: "function",
		Function: wire.Optional[wire.ExternalToolFunction]{
			Valid: true,
			Value: wire.ExternalToolFunction{
				Name:        name,
				Description: opt.description,
				Parameters:  schemaJSON,
			},
		},
	}

	fn := func(args json.RawMessage) (string, error) {
		var params T
		if err := json.Unmarshal(args, &params); err != nil {
			return "", err
		}
		result, err := function(params)
		if err != nil {
			return "", err
		}
		return stringifyResult(result)
	}

	return Tool{call: fn, def: def}, nil
}

func stringifyResult(result any) (string, error) {
	switch v := result.(type) {
	case string:
		return v, nil
	case fmt.Stringer:
		return v.String(), nil
	default:
		data, err := json.Marshal(result)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
}

var replacer = strings.NewReplacer(".", "_")

func getFunctionName[T any](fn T) string {
	fnValue := reflect.ValueOf(fn)
	fnPtr := fnValue.Pointer()
	fnInfo := runtime.FuncForPC(fnPtr)
	if fnInfo == nil {
		return ""
	}
	fullName := fnInfo.Name()
	// Remove -fm suffix for method values
	if dashIdx := strings.Index(fullName, "-"); dashIdx >= 0 {
		fullName = fullName[:dashIdx]
	}
	// Replace '.' with '_'
	// e.g., "main.MyFunction" -> "main_MyFunction"
	return replacer.Replace(fullName)
}

type jsonSchema struct {
	Type        string                 `json:"type,omitempty"`
	Description string                 `json:"description,omitempty"`
	Properties  map[string]*jsonSchema `json:"properties,omitempty"`
	Required    []string               `json:"required,omitempty"`
	Items       *jsonSchema            `json:"items,omitempty"`
}

func generateSchema(t reflect.Type, fieldDescs map[string]string) (*jsonSchema, error) {
	schema := &jsonSchema{}

	switch t.Kind() {
	case reflect.Struct:
		schema.Type = "object"
		schema.Properties = make(map[string]*jsonSchema)
		var required []string

		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if !field.IsExported() {
				continue
			}

			jsonName, desc, isRequired := parseFieldTags(field)
			if jsonName == "-" {
				continue
			}

			fieldSchema, err := generateSchema(field.Type, nil)
			if err != nil {
				return nil, fmt.Errorf("field %s: %w", field.Name, err)
			}

			// Priority: option > struct tag
			if d, ok := fieldDescs[field.Name]; ok {
				fieldSchema.Description = d
			} else if desc != "" {
				fieldSchema.Description = desc
			}

			schema.Properties[jsonName] = fieldSchema

			if isRequired {
				required = append(required, jsonName)
			}
		}

		if len(required) > 0 {
			schema.Required = required
		}

	case reflect.Ptr:
		return generateSchema(t.Elem(), fieldDescs)

	case reflect.Slice, reflect.Array:
		schema.Type = "array"
		items, err := generateSchema(t.Elem(), nil)
		if err != nil {
			return nil, fmt.Errorf("array element: %w", err)
		}
		schema.Items = items

	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return nil, fmt.Errorf("map key must be string, got %s", t.Key().Kind())
		}
		schema.Type = "object"

	case reflect.Bool:
		schema.Type = "boolean"

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		schema.Type = "integer"

	case reflect.Float32, reflect.Float64:
		schema.Type = "number"

	case reflect.String:
		schema.Type = "string"

	default:
		return nil, fmt.Errorf("unsupported type: %s", t.Kind())
	}

	return schema, nil
}

func parseFieldTags(field reflect.StructField) (jsonName, description string, required bool) {
	jsonTag := field.Tag.Get("json")
	if jsonTag == "-" {
		return "-", "", false
	}

	parts := strings.Split(jsonTag, ",")
	jsonName = parts[0]
	if jsonName == "" {
		jsonName = field.Name
	}

	required = true
	for _, part := range parts[1:] {
		if part == "omitempty" || part == "omitzero" {
			required = false
			break
		}
	}

	// Pointer types are always optional
	if field.Type.Kind() == reflect.Ptr {
		required = false
	}

	description = field.Tag.Get("description")
	return
}
