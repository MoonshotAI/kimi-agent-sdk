const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const watchAgentSdkPlugin = {
  name: "watch-agent-sdk",
  setup(build) {
    // Collect agent_sdk files for watching
    const agentSdkDir = path.resolve(__dirname, "../agent_sdk");
    const tsFiles = [];
    function walkDir(dir) {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory() && !file.name.includes("node_modules") && !file.name.includes("dist")) {
          walkDir(fullPath);
        } else if (file.name.endsWith(".ts") && !file.name.endsWith(".test.ts")) {
          tsFiles.push(fullPath);
        }
      }
    }
    walkDir(agentSdkDir);

    // Use onLoad to add watch dependencies for agent_sdk files
    build.onLoad({ filter: /agent_sdk.*\.ts$/ }, (args) => {
      return {
        watchFiles: tsFiles,
      };
    });
  },
};

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
    loader: {
      ".ts": "ts",
    },
    alias: {
      "@moonshot-ai/kimi-agent-sdk": path.resolve(__dirname, "../agent_sdk/index.ts"),
      "@moonshot-ai/kimi-agent-sdk/errors": path.resolve(__dirname, "../agent_sdk/errors.ts"),
      "@moonshot-ai/kimi-agent-sdk/schema": path.resolve(__dirname, "../agent_sdk/schema.ts"),
      "@moonshot-ai/kimi-agent-sdk/utils": path.resolve(__dirname, "../agent_sdk/utils.ts"),
    },
    plugins: [watchAgentSdkPlugin, esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
    console.log("[watch] watching for changes in extension and agent_sdk...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
