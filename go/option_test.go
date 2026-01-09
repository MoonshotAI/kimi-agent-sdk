package kimi

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWithExecutable(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithExecutable("/usr/local/bin/kimi")
	f(opt)

	if opt.exec != "/usr/local/bin/kimi" {
		t.Fatalf("expected exec to be /usr/local/bin/kimi, got %s", opt.exec)
	}
}

func TestWithBaseURL(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithBaseURL("https://api.example.com")
	f(opt)

	expected := []string{"KIMI_BASE_URL=https://api.example.com"}
	if !reflect.DeepEqual(opt.envs, expected) {
		t.Fatalf("expected envs %v, got %v", expected, opt.envs)
	}
}

func TestWithAPIKey(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithAPIKey("sk-test-key-123")
	f(opt)

	expected := []string{"KIMI_API_KEY=sk-test-key-123"}
	if !reflect.DeepEqual(opt.envs, expected) {
		t.Fatalf("expected envs %v, got %v", expected, opt.envs)
	}
}

func TestWithConfig(t *testing.T) {
	cfg := &Config{
		DefaultModel: "test-model",
		Models: map[string]LLMModel{
			"test-model": {
				Provider:       "kimi",
				Model:          "test-model",
				MaxContextSize: 8192,
			},
		},
		Providers: map[string]LLMProvider{
			"kimi": {
				Type:    ProviderTypeKimi,
				BaseURL: "https://api.moonshot.cn",
			},
		},
	}

	opt := &option{exec: "kimi"}
	f := WithConfig(cfg)
	f(opt)

	if len(opt.args) != 2 {
		t.Fatalf("expected 2 args, got %d", len(opt.args))
	}
	if opt.args[0] != "--config" {
		t.Fatalf("expected --config flag, got %s", opt.args[0])
	}

	// Verify JSON is valid
	var parsed Config
	if err := json.Unmarshal([]byte(opt.args[1]), &parsed); err != nil {
		t.Fatalf("failed to parse JSON config: %v", err)
	}
	if parsed.DefaultModel != "test-model" {
		t.Fatalf("expected default_model=test-model, got %s", parsed.DefaultModel)
	}
}

func TestWithConfigFile(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithConfigFile("/path/to/config.toml")
	f(opt)

	expected := []string{"--config-file", "/path/to/config.toml"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithModel(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithModel("moonshot-v1-8k")
	f(opt)

	expected := []string{"--model", "moonshot-v1-8k"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithWorkDir(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithWorkDir("/tmp/workspace")
	f(opt)

	expected := []string{"--work-dir", "/tmp/workspace"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithSession(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithSession("session-123")
	f(opt)

	expected := []string{"--session", "session-123"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithMCPConfigFile(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithMCPConfigFile("/path/to/mcp.json")
	f(opt)

	expected := []string{"--mcp-config-file", "/path/to/mcp.json"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithMCPConfig(t *testing.T) {
	cfg := &MCPConfig{
		Client: MCPClientConfig{
			ToolCallTimeoutMS: 30000,
		},
	}

	opt := &option{exec: "kimi"}
	f := WithMCPConfig(cfg)
	f(opt)

	if len(opt.args) != 2 {
		t.Fatalf("expected 2 args, got %d", len(opt.args))
	}
	if opt.args[0] != "--mcp-config" {
		t.Fatalf("expected --mcp-config flag, got %s", opt.args[0])
	}

	// Verify JSON is valid
	var parsed MCPConfig
	if err := json.Unmarshal([]byte(opt.args[1]), &parsed); err != nil {
		t.Fatalf("failed to parse JSON MCP config: %v", err)
	}
	if parsed.Client.ToolCallTimeoutMS != 30000 {
		t.Fatalf("expected tool_call_timeout_ms=30000, got %d", parsed.Client.ToolCallTimeoutMS)
	}
}

func TestWithAutoApprove(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithAutoApprove()
	f(opt)

	expected := []string{"--auto-approve"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithThinking_True(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithThinking(true)
	f(opt)

	expected := []string{"--thinking"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithThinking_False(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithThinking(false)
	f(opt)

	expected := []string{"--no-thinking"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithSkillsDir(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithSkillsDir("/path/to/skills")
	f(opt)

	expected := []string{"--skills-dir", "/path/to/skills"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithArgs(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithArgs("--mode", "test", "--verbose")
	f(opt)

	expected := []string{"--mode", "test", "--verbose"}
	if !reflect.DeepEqual(opt.args, expected) {
		t.Fatalf("expected args %v, got %v", expected, opt.args)
	}
}

func TestWithArgs_Empty(t *testing.T) {
	opt := &option{exec: "kimi"}
	f := WithArgs()
	f(opt)

	if len(opt.args) != 0 {
		t.Fatalf("expected empty args, got %v", opt.args)
	}
}

func TestOptions_Chaining(t *testing.T) {
	options := []Option{
		WithExecutable("/custom/kimi"),
		WithModel("moonshot-v1"),
		WithWorkDir("/tmp"),
		WithAutoApprove(),
		WithThinking(true),
	}

	opt := &option{exec: "kimi"}
	for _, f := range options {
		if f != nil {
			f(opt)
		}
	}

	if opt.exec != "/custom/kimi" {
		t.Fatalf("expected exec=/custom/kimi, got %s", opt.exec)
	}

	expectedArgs := []string{
		"--model", "moonshot-v1",
		"--work-dir", "/tmp",
		"--auto-approve",
		"--thinking",
	}
	if !reflect.DeepEqual(opt.args, expectedArgs) {
		t.Fatalf("expected args %v, got %v", expectedArgs, opt.args)
	}
}
