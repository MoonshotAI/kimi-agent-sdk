import * as fs from "node:fs";
import * as toml from "toml";
import { z } from "zod";
import { KimiPaths } from "./paths";
import type { KimiConfig, ModelConfig } from "./schema";

// ============================================================================
// Config Schema
// ============================================================================

const ProviderTypeSchema = z.enum(["kimi", "openai_legacy", "openai_responses", "anthropic", "google_genai", "gemini", "vertexai"]);

const LLMProviderSchema = z.object({
  type: ProviderTypeSchema,
  base_url: z.string(),
  api_key: z.string(),
  env: z.record(z.string()).optional(),
  custom_headers: z.record(z.string()).optional(),
});

const ModelCapabilitySchema = z.enum(["thinking", "always_thinking", "image_in", "video_in"]);

const LLMModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  max_context_size: z.number().int().positive(),
  capabilities: z.array(ModelCapabilitySchema).optional(),
});

const LoopControlSchema = z.object({
  max_steps_per_turn: z.number().int().min(1).default(100),
  max_retries_per_step: z.number().int().min(1).default(3),
  max_ralph_iterations: z.number().int().min(-1).default(0),
});

const MoonshotSearchConfigSchema = z.object({
  base_url: z.string(),
  api_key: z.string(),
  custom_headers: z.record(z.string()).optional(),
});

const MoonshotFetchConfigSchema = z.object({
  base_url: z.string(),
  api_key: z.string(),
  custom_headers: z.record(z.string()).optional(),
});

const ServicesSchema = z.object({
  moonshot_search: MoonshotSearchConfigSchema.optional(),
  moonshot_fetch: MoonshotFetchConfigSchema.optional(),
});

const MCPClientConfigSchema = z.object({
  tool_call_timeout_ms: z.number().int().positive().default(60000),
});

const MCPConfigSchema = z.object({
  client: MCPClientConfigSchema.default({}),
});

const DefaultThinkingSchema = z
  .preprocess((val) => {
    if (val === "on") {
      return true;
    }
    if (val === "off") {
      return false;
    }
    return val;
  }, z.boolean())
  .default(false);

const ConfigSchema = z.object({
  default_model: z.string().default(""),
  default_thinking: DefaultThinkingSchema,
  models: z.record(LLMModelSchema).default({}),
  providers: z.record(LLMProviderSchema).default({}),
  loop_control: LoopControlSchema.default({}),
  services: ServicesSchema.default({}),
  mcp: MCPConfigSchema.default({}),
});

type Config = z.infer<typeof ConfigSchema>;

// Config Parsing
export function parseConfig(): KimiConfig {
  if (!fs.existsSync(KimiPaths.config)) {
    return { defaultModel: null, defaultThinking: false, models: [] };
  }

  try {
    const raw = toml.parse(fs.readFileSync(KimiPaths.config, "utf-8"));
    const config = ConfigSchema.parse(raw);
    return toKimiConfig(config);
  } catch (err) {
    console.warn("[config] Failed to parse config.toml:", err);
    return { defaultModel: null, defaultThinking: false, models: [] };
  }
}

function toKimiConfig(config: Config): KimiConfig {
  const models: ModelConfig[] = Object.entries(config.models).map(([id, model]) => ({
    id,
    name: id,
    capabilities: model.capabilities ?? [],
  }));

  models.sort((a, b) => a.name.localeCompare(b.name));

  return {
    defaultModel: config.default_model || null,
    defaultThinking: config.default_thinking,
    models,
  };
}

// Config Saving
// This is deliberately simple and only handles the default_model setting.
// Otherwise the toml lib will change the format / default values.
export function saveDefaultModel(modelId: string, thinking?: boolean): void {
  const configPath = KimiPaths.config;

  if (!fs.existsSync(configPath)) {
    let content = `default_model = "${modelId}"\n`;
    if (thinking !== undefined) {
      content += `default_thinking = ${thinking}\n`;
    }
    fs.writeFileSync(configPath, content, "utf-8");
    return;
  }

  let content = fs.readFileSync(configPath, "utf-8");

  // Update default_model
  const modelRegex = /^default_model\s*=\s*"[^"]*"/m;

  if (modelRegex.test(content)) {
    content = content.replace(modelRegex, `default_model = "${modelId}"`);
  } else {
    content = `default_model = "${modelId}"\n` + content;
  }

  // Update default_thinking if provided
  if (thinking !== undefined) {
    const thinkingRegex = /^default_thinking\s*=\s*(?:true|false|"[^"]*")/m;
    const thinkingValue = thinking ? "true" : "false";
    if (thinkingRegex.test(content)) {
      content = content.replace(thinkingRegex, `default_thinking = ${thinkingValue}`); // 不带引号
    } else {
      content = content.replace(/^(default_model\s*=\s*"[^"]*")/m, `$1\ndefault_thinking = ${thinkingValue}`); // 不带引号
    }
  }

  fs.writeFileSync(configPath, content, "utf-8");
}

// Model Utilities
export function getModelById(models: ModelConfig[], modelId: string): ModelConfig | undefined {
  return models.find((m) => m.id === modelId);
}

export type ThinkingMode = "none" | "switch" | "always";

export function getModelThinkingMode(model: ModelConfig): ThinkingMode {
  // Model name contains "think" → always_thinking
  if (model.name.toLowerCase().includes("think")) {
    return "always";
  }
  // capabilities contains always_thinking
  if (model.capabilities.includes("always_thinking")) {
    return "always";
  }
  // capabilities contains thinking
  if (model.capabilities.includes("thinking")) {
    return "switch";
  }
  return "none";
}

export function isModelThinking(models: ModelConfig[], modelId: string): boolean {
  const model = getModelById(models, modelId);
  if (!model) {
    return false;
  }
  const mode = getModelThinkingMode(model);
  return mode === "always" || mode === "switch";
}
