import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ExternalTool, ExternalToolHandler } from "./schema";

// Convert Zod schema to JSON Schema, compatible with both Zod 3 and Zod 4
function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Zod 4 has native toJSONSchema support
  if ("toJSONSchema" in z && typeof (z as Record<string, unknown>).toJSONSchema === "function") {
    return (z as unknown as { toJSONSchema: (schema: z.ZodTypeAny) => Record<string, unknown> }).toJSONSchema(schema);
  }
  // Fallback to zod-to-json-schema for Zod 3
  return zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
}

export function createExternalTool<T extends z.ZodObject<z.ZodRawShape>>(definition: {
  name: string;
  description: string;
  parameters: T;
  handler: (params: z.infer<T>) => Promise<{ output: string; message: string }>;
}): ExternalTool {
  const jsonSchema = toJsonSchema(definition.parameters);

  const handler: ExternalToolHandler = async (params) => {
    const parsed = definition.parameters.parse(params);
    return definition.handler(parsed);
  };

  return {
    name: definition.name,
    description: definition.description,
    parameters: jsonSchema as Record<string, unknown>,
    handler,
  };
}
