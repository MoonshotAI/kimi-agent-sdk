package kimi

type ProviderType string

const (
	ProviderTypeKimi            ProviderType = "kimi"
	ProviderTypeOpenAILegacy    ProviderType = "openai_legacy"   // legacy OpenAI-compatible API endpoint
	ProviderTypeOpenAIResponses ProviderType = "openai_responses" // OpenAI Responses API endpoint
	ProviderTypeAnthropic       ProviderType = "anthropic"
	ProviderTypeGoogleGenAI     ProviderType = "google_genai" // for backward-compatibility, equals to `gemini`
	ProviderTypeGemini          ProviderType = "gemini"
	ProviderTypeVertexAI        ProviderType = "vertexai"
)

type ModelCapability string

const (
	ModelCapabilityImageIn  ModelCapability = "image_in"
	ModelCapabilityVideoIn  ModelCapability = "video_in"
	ModelCapabilityThinking ModelCapability = "thinking"
)

type LLMProvider struct {
	Type          ProviderType      `json:"type" toml:"type"`
	BaseURL       string            `json:"base_url" toml:"base_url"`
	APIKey        string            `json:"api_key" toml:"api_key"`
	Env           map[string]string `json:"env,omitempty" toml:"env,omitempty"`
	CustomHeaders map[string]string `json:"custom_headers,omitempty" toml:"custom_headers,omitempty"`
}

type LLMModel struct {
	Provider       string                   `json:"provider" toml:"provider"`
	Model          string                   `json:"model" toml:"model"`
	MaxContextSize int                      `json:"max_context_size" toml:"max_context_size"`
	Capabilities   map[ModelCapability]bool `json:"capabilities,omitempty" toml:"capabilities,omitempty"`
}

type LoopControl struct {
	MaxStepsPerRun    int `json:"max_steps_per_run" toml:"max_steps_per_run"`
	MaxRetriesPerStep int `json:"max_retries_per_step" toml:"max_retries_per_step"`
}

type MoonshotSearchConfig struct {
	BaseURL       string            `json:"base_url" toml:"base_url"`
	APIKey        string            `json:"api_key" toml:"api_key"`
	CustomHeaders map[string]string `json:"custom_headers,omitempty" toml:"custom_headers,omitempty"`
}

type MoonshotFetchConfig struct {
	BaseURL       string            `json:"base_url" toml:"base_url"`
	APIKey        string            `json:"api_key" toml:"api_key"`
	CustomHeaders map[string]string `json:"custom_headers,omitempty" toml:"custom_headers,omitempty"`
}

type Services struct {
	MoonshotSearch *MoonshotSearchConfig `json:"moonshot_search,omitempty" toml:"moonshot_search,omitempty"`
	MoonshotFetch  *MoonshotFetchConfig  `json:"moonshot_fetch,omitempty" toml:"moonshot_fetch,omitempty"`
}

type MCPClientConfig struct {
	ToolCallTimeoutMS int `json:"tool_call_timeout_ms" toml:"tool_call_timeout_ms"`
}

type MCPConfig struct {
	Client MCPClientConfig `json:"client" toml:"client"`
}

type Config struct {
	DefaultModel string                 `json:"default_model" toml:"default_model"`
	Models       map[string]LLMModel    `json:"models" toml:"models"`
	Providers    map[string]LLMProvider `json:"providers" toml:"providers"`
	LoopControl  LoopControl            `json:"loop_control" toml:"loop_control"`
	Services     Services               `json:"services" toml:"services"`
	MCP          MCPConfig              `json:"mcp" toml:"mcp"`
}
