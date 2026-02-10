import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractBrief, extractTextFromContentParts, formatContentOutput, collectText } from "../utils";
import { createKimiPaths } from "../paths";
import * as os from "node:os";
import * as path from "node:path";
import type { DisplayBlock, ContentPart, StreamEvent } from "../schema";

// ============================================================================
// extractBrief Tests
// ============================================================================
describe("extractBrief", () => {
  it("extracts brief text from display blocks", () => {
    const display: DisplayBlock[] = [
      { type: "diff", path: "/file.ts", old_text: "a", new_text: "b" },
      { type: "brief", text: "Modified file.ts" },
      { type: "todo", items: [{ title: "Task", status: "done" }] },
    ];
    expect(extractBrief(display)).toBe("Modified file.ts");
  });

  it("returns first brief when multiple exist", () => {
    const display: DisplayBlock[] = [
      { type: "brief", text: "First brief" },
      { type: "brief", text: "Second brief" },
    ];
    expect(extractBrief(display)).toBe("First brief");
  });

  it("returns empty string when no brief block", () => {
    const display: DisplayBlock[] = [{ type: "diff", path: "/file.ts", old_text: "a", new_text: "b" }];
    expect(extractBrief(display)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractBrief(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractBrief([])).toBe("");
  });
});

// ============================================================================
// extractTextFromContentParts Tests
// ============================================================================
describe("extractTextFromContentParts", () => {
  it("extracts text from text parts", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ];
    expect(extractTextFromContentParts(parts)).toBe("Hello\nWorld");
  });

  it("filters out non-text parts", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "Before" },
      { type: "think", think: "thinking...", encrypted: null },
      { type: "text", text: "After" },
      { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
    ];
    expect(extractTextFromContentParts(parts)).toBe("Before\nAfter");
  });

  it("returns empty string for empty array", () => {
    expect(extractTextFromContentParts([])).toBe("");
  });

  it("returns empty string when no text parts", () => {
    const parts: ContentPart[] = [
      { type: "think", think: "thinking..." },
      { type: "image_url", image_url: { url: "..." } },
    ];
    expect(extractTextFromContentParts(parts)).toBe("");
  });

  it("handles single text part", () => {
    const parts: ContentPart[] = [{ type: "text", text: "Single" }];
    expect(extractTextFromContentParts(parts)).toBe("Single");
  });
});

// ============================================================================
// formatContentOutput Tests
// ============================================================================
describe("formatContentOutput", () => {
  it("returns string as-is", () => {
    expect(formatContentOutput("Hello, World!")).toBe("Hello, World!");
  });

  it("returns empty string as-is", () => {
    expect(formatContentOutput("")).toBe("");
  });

  it("formats ContentPart array with text parts", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "Line 1" },
      { type: "text", text: "Line 2" },
    ];
    expect(formatContentOutput(parts)).toBe("Line 1\nLine 2");
  });

  it("shows placeholder for non-text parts", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "Before" },
      { type: "image_url", image_url: { url: "..." } },
      { type: "text", text: "After" },
    ];
    expect(formatContentOutput(parts)).toBe("Before\n[image_url]\nAfter");
  });

  it("handles think parts", () => {
    const parts: ContentPart[] = [
      { type: "think", think: "reasoning..." },
      { type: "text", text: "Result" },
    ];
    expect(formatContentOutput(parts)).toBe("[think]\nResult");
  });

  it("handles audio_url parts", () => {
    const parts: ContentPart[] = [{ type: "audio_url", audio_url: { url: "data:audio/aac;base64,..." } }];
    expect(formatContentOutput(parts)).toBe("[audio_url]");
  });

  it("handles video_url parts", () => {
    const parts: ContentPart[] = [{ type: "video_url", video_url: { url: "data:video/mp4;base64,..." } }];
    expect(formatContentOutput(parts)).toBe("[video_url]");
  });

  it("handles empty array", () => {
    expect(formatContentOutput([])).toBe("");
  });

  it("handles mixed array with strings (edge case)", () => {
    // This tests the internal string handling in the array case
    const parts = ["raw string" as unknown as ContentPart];
    expect(formatContentOutput(parts)).toBe("raw string");
  });

  it("stringifies non-array non-string input", () => {
    // Edge case: input is neither string nor array
    const obj = { foo: "bar" } as unknown as string | ContentPart[];
    expect(formatContentOutput(obj)).toBe('{"foo":"bar"}');
  });
});

// ============================================================================
// collectText Tests
// ============================================================================
describe("collectText", () => {
  it("collects text from ContentPart events", () => {
    const events: StreamEvent[] = [
      { type: "ContentPart", payload: { type: "text", text: "Hello " } },
      { type: "ContentPart", payload: { type: "text", text: "World" } },
    ];
    expect(collectText(events)).toBe("Hello World");
  });

  it("filters out non-text ContentPart events", () => {
    const events: StreamEvent[] = [
      { type: "ContentPart", payload: { type: "text", text: "Before" } },
      { type: "ContentPart", payload: { type: "think", think: "thinking..." } },
      { type: "ContentPart", payload: { type: "text", text: "After" } },
    ];
    expect(collectText(events)).toBe("BeforeAfter");
  });

  it("filters out non-ContentPart events", () => {
    const events: StreamEvent[] = [
      { type: "TurnBegin", payload: { user_input: "test" } },
      { type: "ContentPart", payload: { type: "text", text: "Response" } },
      { type: "StepBegin", payload: { n: 1 } },
      { type: "ContentPart", payload: { type: "text", text: " done" } },
      { type: "StatusUpdate", payload: {} },
    ];
    expect(collectText(events)).toBe("Response done");
  });

  it("returns empty string for empty array", () => {
    expect(collectText([])).toBe("");
  });

  it("returns empty string when no text ContentPart events", () => {
    const events: StreamEvent[] = [
      { type: "TurnBegin", payload: { user_input: "test" } },
      { type: "ContentPart", payload: { type: "think", think: "thinking..." } },
      { type: "StepBegin", payload: { n: 1 } },
    ];
    expect(collectText(events)).toBe("");
  });

  it("handles single text event", () => {
    const events: StreamEvent[] = [{ type: "ContentPart", payload: { type: "text", text: "Single" } }];
    expect(collectText(events)).toBe("Single");
  });

  it("handles image_url ContentPart events", () => {
    const events: StreamEvent[] = [
      { type: "ContentPart", payload: { type: "text", text: "Image: " } },
      { type: "ContentPart", payload: { type: "image_url", image_url: { url: "data:image/png;base64,..." } } },
      { type: "ContentPart", payload: { type: "text", text: "done" } },
    ];
    expect(collectText(events)).toBe("Image: done");
  });
});

// ============================================================================
// createKimiPaths Tests
// ============================================================================
describe("createKimiPaths", () => {
  const originalEnv = process.env.KIMI_SHARE_DIR;

  beforeEach(() => {
    delete process.env.KIMI_SHARE_DIR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KIMI_SHARE_DIR = originalEnv;
    } else {
      delete process.env.KIMI_SHARE_DIR;
    }
  });

  it("uses provided shareDir", () => {
    const paths = createKimiPaths("/custom/kimi");
    expect(paths.home).toBe("/custom/kimi");
    expect(paths.config).toBe("/custom/kimi/config.toml");
    expect(paths.mcpConfig).toBe("/custom/kimi/mcp.json");
  });

  it("uses KIMI_SHARE_DIR env var when shareDir not provided", () => {
    process.env.KIMI_SHARE_DIR = "/env/kimi";
    const paths = createKimiPaths();
    expect(paths.home).toBe("/env/kimi");
    expect(paths.config).toBe("/env/kimi/config.toml");
  });

  it("uses ~/.kimi as default", () => {
    const paths = createKimiPaths();
    const expectedHome = path.join(os.homedir(), ".kimi");
    expect(paths.home).toBe(expectedHome);
    expect(paths.config).toBe(path.join(expectedHome, "config.toml"));
  });

  it("shareDir takes precedence over env var", () => {
    process.env.KIMI_SHARE_DIR = "/env/kimi";
    const paths = createKimiPaths("/custom/kimi");
    expect(paths.home).toBe("/custom/kimi");
  });

  it("generates correct session paths", () => {
    const paths = createKimiPaths("/kimi");
    const sessionsDir = paths.sessionsDir("/project");
    const sessionDir = paths.sessionDir("/project", "sess-123");
    const baselineDir = paths.baselineDir("/project", "sess-123");

    expect(sessionsDir).toMatch(/^\/kimi\/sessions\/[a-f0-9]{32}$/);
    expect(sessionDir).toMatch(/^\/kimi\/sessions\/[a-f0-9]{32}\/sess-123$/);
    expect(baselineDir).toMatch(/^\/kimi\/sessions\/[a-f0-9]{32}\/sess-123\/baseline$/);
  });

  it("generates consistent hash for same workDir", () => {
    const paths = createKimiPaths("/kimi");
    const dir1 = paths.sessionsDir("/project");
    const dir2 = paths.sessionsDir("/project");
    expect(dir1).toBe(dir2);
  });

  it("generates different hash for different workDir", () => {
    const paths = createKimiPaths("/kimi");
    const dir1 = paths.sessionsDir("/project1");
    const dir2 = paths.sessionsDir("/project2");
    expect(dir1).not.toBe(dir2);
  });
});
