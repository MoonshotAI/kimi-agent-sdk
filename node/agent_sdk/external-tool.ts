import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ExternalTool, ExternalToolHandler } from "./schema";

export function createExternalTool<T extends z.ZodObject<z.ZodRawShape>>(definition: {
  name: string;
  description: string;
  parameters: T;
  handler: (params: z.infer<T>) => Promise<{ output: string; message: string }>;
}): ExternalTool {
  const jsonSchema = zodToJsonSchema(definition.parameters, { $refStrategy: "none" });

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
