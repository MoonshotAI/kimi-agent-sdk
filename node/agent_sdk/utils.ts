import type { DisplayBlock, BriefBlock, ContentPart, StreamEvent } from "./schema";

// Display Block Helpers
export function extractBrief(display?: DisplayBlock[]): string {
  const brief = display?.find((d): d is BriefBlock => d.type === "brief");
  return brief?.text ?? "";
}

// Stream Event Helpers
/** Collect all text content from stream events */
export function collectText(events: StreamEvent[]): string {
  return events
    .filter((e): e is { type: "ContentPart"; payload: { type: "text"; text: string } } => e.type === "ContentPart" && "payload" in e && e.payload.type === "text")
    .map((e) => e.payload.text)
    .join("");
}

// Content Part Helpers
export function extractTextFromContentParts(parts: ContentPart[]): string {
  return parts
    .filter((p): p is ContentPart & { type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function formatContentOutput(output: string | ContentPart[]): string {
  if (typeof output === "string") {
    return output;
  }

  if (!Array.isArray(output)) {
    return JSON.stringify(output);
  }

  return output
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item.type === "text") {
        return item.text;
      }
      // Placeholder for non-text parts for debugging
      return `[${item.type}]`;
    })
    .filter(Boolean)
    .join("\n");
}
