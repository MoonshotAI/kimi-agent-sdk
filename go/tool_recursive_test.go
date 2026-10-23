package kimi

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"reflect"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

type recursivePointerParams struct {
	Next *recursivePointerParams `json:"next,omitempty"`
}

type recursiveSliceParams struct {
	Children []recursiveSliceParams `json:"children,omitempty"`
}

type recursiveFirstParams struct {
	Second recursiveSecondParams `json:"second"`
}

type recursiveSecondParams struct {
	First *recursiveFirstParams `json:"first,omitempty"`
}

func TestCreateTool_RecursiveSchema(t *testing.T) {
	const childEnv = "KIMI_TEST_RECURSIVE_TOOL_SCHEMA"
	if os.Getenv(childEnv) != "1" {
		// A regression would fatally overflow the stack, bypassing recover.
		// Keep that failure in a bounded child rather than crashing the suite.
		executable, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, executable, "-test.run=^TestCreateTool_RecursiveSchema$")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("recursive schema subprocess failed: %v\n%.2000s", err, output)
		}
		return
	}

	debug.SetMaxStack(128 << 10)
	tests := []struct {
		name   string
		create func() (Tool, error)
	}{
		{"pointer", func() (Tool, error) {
			return CreateTool(func(recursivePointerParams) (string, error) { return "", nil })
		}},
		{"slice", func() (Tool, error) {
			return CreateTool(func(recursiveSliceParams) (string, error) { return "", nil })
		}},
		{"indirect", func() (Tool, error) {
			return CreateTool(func(recursiveFirstParams) (string, error) { return "", nil })
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.create()
			if err == nil || !strings.Contains(err.Error(), "recursive type") || !strings.Contains(err.Error(), "WithSchema") {
				t.Fatalf("expected actionable recursive schema error, got %v", err)
			}
		})
	}
}

func TestCreateTool_RepeatedSchemaTypes(t *testing.T) {
	type params struct {
		Primary UserInfo   `json:"primary"`
		Backup  *UserInfo  `json:"backup,omitempty"`
		Others  []UserInfo `json:"others"`
	}
	tool, err := CreateTool(func(params) (string, error) { return "", nil })
	if err != nil {
		t.Fatal(err)
	}
	var schema jsonSchema
	if err := json.Unmarshal(tool.def.Parameters, &schema); err != nil {
		t.Fatal(err)
	}
	primary := schema.Properties["primary"]
	if primary.Type != "object" || primary.Properties["name"].Type != "string" {
		t.Fatalf("unexpected primary schema: %+v", primary)
	}
	if !reflect.DeepEqual(primary, schema.Properties["backup"]) || !reflect.DeepEqual(primary, schema.Properties["others"].Items) {
		t.Fatal("sibling fields must each retain the shared type's schema")
	}
}

func TestCreateTool_IgnoredRecursiveFields(t *testing.T) {
	type params struct {
		Value   string  `json:"value"`
		Ignored *params `json:"-"`
		private *params
	}
	tool, err := CreateTool(func(value params) (bool, error) {
		return value.private == nil && value.Ignored == nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := tool.call(json.RawMessage(`{"value":"ok","Ignored":{},"private":{}}`))
	if err != nil || result != "true" {
		t.Fatalf("ignored fields should remain unset: result=%q, err=%v", result, err)
	}
}

func TestCreateTool_RecursiveTypeWithExplicitSchema(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"next":{"$ref":"#"}}}`)
	tool, err := CreateTool(func(params recursivePointerParams) (string, error) {
		if params.Next != nil {
			return "has next", nil
		}
		return "empty", nil
	}, WithSchema(schema))
	if err != nil {
		t.Fatal(err)
	}
	if string(tool.def.Parameters) != string(schema) {
		t.Fatal("explicit schema was not preserved")
	}
	result, err := tool.call(json.RawMessage(`{"next":{}}`))
	if err != nil || result != "has next" {
		t.Fatalf("explicit-schema tool call: result=%q, err=%v", result, err)
	}
}
