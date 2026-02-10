import * as fs from "node:fs";
import * as toml from "toml";
import { z } from "zod";
import { KimiPaths, createKimiPaths } from "./paths";
import { log } from "./logger";
import type { KimiConfig, ModelConfig } from "./schema";

// ============================================================================
// Config Schema
// ============================================================================

const OAuthConfigSchema = z.object({
  storage: z.string(),
  key: z.string(),
});

const ProviderTypeSchema = z.enum(["kimi", "openai_legacy", "openai_responses", "anthropic", "google_genai", "gemini", "vertexai"]);

const LLMProviderSchema = z.object({
  type: ProviderTypeSchema,
  base_url: z.string(),
  api_key: z.string(),
  env: z.record(z.string(), z.string()).optional(),
  custom_headers: z.record(z.string(), z.string()).optional(),
  oauth: OAuthConfigSchema.optional(),
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
  custom_headers: z.record(z.string(), z.string()).optional(),
});

const MoonshotFetchConfigSchema = z.object({
  base_url: z.string(),
  api_key: z.string(),
  custom_headers: z.record(z.string(), z.string()).optional(),
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
  models: z.record(z.string(), LLMModelSchema).default({}),
  providers: z.record(z.string(), LLMProviderSchema).default({}),
  loop_control: LoopControlSchema.default({}),
  services: ServicesSchema.default({}),
  mcp: MCPConfigSchema.default({}),
});

type Config = z.infer<typeof ConfigSchema>;

// Config Parsing
function readConfigToml(configPath: string): unknown | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return toml.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    log.config("Failed to read/parse config.toml: %O", err);
    return null;
  }
}

export function parseConfig(shareDir?: string): KimiConfig {
  const paths = shareDir ? createKimiPaths(shareDir) : KimiPaths;
  const raw = readConfigToml(paths.config);
  if (!raw) {
    log.config("Config file not found: %s", paths.config);
    return { defaultModel: null, defaultThinking: false, models: [] };
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    log.config("Failed to validate config.toml: %O", parsed.error);
    return { defaultModel: null, defaultThinking: false, models: [] };
  }

  const config = parsed.data;
  log.config("Parsed config with %d models", Object.keys(config.models).length);
  return toKimiConfig(config);
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

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return !!val && typeof val === "object" && !Array.isArray(val);
}

export function isLoggedIn(shareDir?: string): boolean {
  const paths = shareDir ? createKimiPaths(shareDir) : KimiPaths;
  const raw = readConfigToml(paths.config);
  if (!raw || !isPlainObject(raw)) {
    return false;
  }

  const providers = raw["providers"];
  if (!isPlainObject(providers)) {
    return false;
  }

  const provider = providers["managed:kimi-code"];
  if (!isPlainObject(provider)) {
    return false;
  }

  const apiKey = provider["api_key"];
  const hasApiKey = typeof apiKey === "string" && apiKey.length > 0;

  const oauth = provider["oauth"];
  const hasOAuth = isPlainObject(oauth);

  return hasApiKey || hasOAuth;
}

// Config Saving
// This is deliberately simple and only handles the default_model setting.
// Otherwise the toml lib will change the format / default values.
export function saveDefaultModel(modelId: string, thinking?: boolean, shareDir?: string): void {
  const paths = shareDir ? createKimiPaths(shareDir) : KimiPaths;
  const configPath = paths.config;

  if (!fs.existsSync(configPath)) {
    let content = `default_model = "${modelId}"\n`;
    if (thinking !== undefined) {
      content += `default_thinking = ${thinking}\n`;
    }
    fs.writeFileSync(configPath, content, "utf-8");
    log.config("Created config with default model: %s", modelId);
    return;
  }

  let content = fs.readFileSync(configPath, "utf-8");

  const modelRegex = /^default_model\s*=\s*"[^"]*"/m;
  if (modelRegex.test(content)) {
    content = content.replace(modelRegex, `default_model = "${modelId}"`);
  } else {
    content = `default_model = "${modelId}"\n` + content;
  }

  if (thinking !== undefined) {
    const thinkingRegex = /^default_thinking\s*=\s*(?:true|false|"[^"]*")/m;
    const thinkingValue = thinking ? "true" : "false";
    if (thinkingRegex.test(content)) {
      content = content.replace(thinkingRegex, `default_thinking = ${thinkingValue}`);
    } else {
      content = content.replace(/^(default_model\s*=\s*"[^"]*")/m, `$1\ndefault_thinking = ${thinkingValue}`);
    }
  }

  fs.writeFileSync(configPath, content, "utf-8");
  log.config("Updated default model: %s, thinking: %s", modelId, thinking);
}

export function getModelById(models: ModelConfig[], modelId: string): ModelConfig | undefined {
  return models.find((m) => m.id === modelId);
}

export type ThinkingMode = "none" | "switch" | "always";

export function getModelThinkingMode(model: ModelConfig): ThinkingMode {
  if (model.name.toLowerCase().includes("think")) {
    return "always";
  }
  if (model.capabilities.includes("always_thinking")) {
    return "always";
  }
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
