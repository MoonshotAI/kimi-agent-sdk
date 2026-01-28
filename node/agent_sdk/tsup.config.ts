import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: {
    index: "index.ts",
    schema: "schema.ts",
    errors: "errors.ts",
    utils: "utils.ts",
  },
  format: ["esm", "cjs"],
  outDir: "dist",
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".mjs",
    };
  },
  dts: {
    entry: {
      index: "index.ts",
      schema: "schema.ts",
      errors: "errors.ts",
      utils: "utils.ts",
    },
  },
  splitting: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  external: ["node:*"],
  define: {
    "process.env.BROWSER": "false",
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
