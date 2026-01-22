# Kimi Agent SDK

[![Go SDK Version](https://img.shields.io/github/v/tag/MoonshotAI/kimi-agent-sdk?label=go%20sdk&sort=semver&filter=go-v*)](https://pkg.go.dev/github.com/MoonshotAI/kimi-agent-sdk/go)
[![Node SDK Version](https://img.shields.io/npm/v/%40moonshot-ai%2Fkimi-agent-sdk?label=node%20sdk)](https://www.npmjs.com/package/@moonshot-ai/kimi-agent-sdk)
[![Python SDK Version](https://img.shields.io/pypi/v/kimi-agent-sdk?label=python%20sdk)](https://pypi.org/project/kimi-agent-sdk/)  

[![License](https://img.shields.io/github/license/MoonshotAI/kimi-agent-sdk)](./LICENSE)

Kimi Agent SDK is a set of multi-language libraries that expose the [Kimi Code (Kimi CLI)]((https://github.com/MoonshotAI/kimi-cli)) agent runtime in your applications. Use it to build products, automations, and custom tooling while keeping the CLI as the execution engine.

The SDKs are thin, language-native clients that reuse the same Kimi CLI configuration, tools, skills, and MCP servers. They stream responses in real time, surface approvals and tool calls, and let you orchestrate sessions programmatically.

## Overview

Kimi Agent SDK provides a programmatic interface to interact with the Kimi CLI, enabling you to:

- **Build custom applications** - Integrate Kimi Agent into your own tools and workflows
- **Automate tasks** - Script complex multi-turn conversations
- **Extend capabilities** - Register custom tools that the model can call
- **Handle approvals** - Programmatically respond to permission requests

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| Go | [go/](./go) | Available |
| Node.js | [node/agent_sdk/](./node/agent_sdk/) | Available |
| Python | [python/](./python/) | Available |

## Quick Start

### Installation

```bash
# Go
go get github.com/MoonshotAI/kimi-agent-sdk/go
```

Go quick start: [guides/go/quickstart.md](./guides/go/quickstart.md)

```bash
# Node.js
npm install @moonshot-ai/kimi-agent-sdk
```

Node.js quick start: [node/agent_sdk/README.md#quick-start](./node/agent_sdk/README.md#quick-start)

```bash
# Python
pip install kimi-agent-sdk
```

Python quick start: [guides/python/quickstart.md](./guides/python/quickstart.md)
