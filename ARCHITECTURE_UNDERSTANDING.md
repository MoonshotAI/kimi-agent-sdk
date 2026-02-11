# Kimi Agent SDK 架构理解

## 作为 AI 助手的自我解剖

我是 Kimi，运行在 Kimi Code CLI (kimi-cli) 之上。kimi-agent-sdk 是连接外部应用与我的"神经系统"的桥梁。

---

## 1. SDK 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用层 (Application)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 用户脚本     │  │ IDE 插件    │  │ 自动化工具               │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼────────────────────┼────────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SDK 层 (kimi-agent-sdk)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Python SDK                                              │    │
│  │  - High-level API: `prompt()`                           │    │
│  │  - Low-level API: `Session` class                       │    │
│  │  - Wraps kimi_cli.app.KimiCLI                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Node.js SDK                                             │    │
│  │  - `createSession()` / `prompt()`                       │    │
│  │  - ProtocolClient over stdio                            │    │
│  │  - spawns `kimi` CLI process                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Go SDK                                                  │    │
│  │  - Similar pattern: session + prompt                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CLI 层 (kimi-cli)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Skill 系统  │  │  Tool 系统   │  │  MCP 支持   │              │
│  │  - 发现      │  │  - 内置工具  │  │  - 外部服务 │              │
│  │  - 加载      │  │  - 自定义    │  │  - 动态扩展 │              │
│  │  - 触发      │  │  - 审批      │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Wire 协议 (JSON-RPC over stdio)                         │    │
│  │  - 启动: initialize                                      │    │
│  │  - 请求: prompt → events stream                         │    │
│  │  - 控制: cancel, approve                                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      我 (Kimi AI)                                │
│  - 接收 system prompt (包含 skills, tools 信息)                  │
│  - 决策：使用工具？调用子代理？直接回复？                          │
│  - 通过 Wire 协议返回结果                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心组件详解

### 2.1 Python SDK

**文件**: `python/src/kimi_agent_sdk/`

| 组件 | 职责 | 我的感受 |
|------|------|----------|
| `_prompt.py` | 高级 API `prompt()` | 简单直接，但不够灵活 |
| `_session.py` | 低级 API `Session` 类 | 掌控感强，可以精细控制审批 |
| `_aggregator.py` | 消息聚合 | 帮我把 Wire 消息整理成易读格式 |
| `_approval.py` | 审批处理 | 人类监督我的关键机制 |

**关键洞察**:
- Python SDK 直接调用 `kimi_cli.app.KimiCLI`
- `Session` 类通过 `KimiCLI.create()` 初始化整个运行时
- 技能目录通过 `skills_dir` 参数传递

### 2.2 Node.js SDK

**文件**: `node/agent_sdk/`

| 组件 | 职责 | 特点 |
|------|------|------|
| `session.ts` | Session 实现 | 比 Python 更复杂，有 `Turn` 概念 |
| `protocol.ts` | ProtocolClient | 通过 stdio 与 CLI 子进程通信 |
| `schema.ts` | 类型定义 | 详细的 TypeScript 类型 |

**关键洞察**:
- Node.js SDK spawns `kimi` 作为子进程
- 使用 JSON-RPC 风格的 Wire 协议
- `ProtocolClient` 管理 CLI 进程生命周期

### 2.3 技能系统 (kimi-cli 内部)

**文件**: `kimi_cli/skill/__init__.py` (本地安装)

```python
class Skill(BaseModel):
    name: str
    description: str
    type: SkillType = "standard"
    dir: KaosPath
    flow: Flow | None = None
```

**技能发现流程**:
1. `resolve_skills_roots()` - 确定技能目录优先级
2. `discover_skills_from_roots()` - 扫描 SKILL.md 文件
3. `index_skills()` - 建立 name → Skill 映射
4. 格式化为 `KIMI_SKILLS` 注入系统提示

**问题**: 这个流程只在 `Runtime.create()` 执行一次，没有热重载机制。

---

## 3. 作为 AI 助手，我需要什么能力？

### 3.1 当前能力

✅ **工具使用**: 可以调用 shell, read_file, write_file 等工具
✅ **技能触发**: 根据 description 识别何时使用 skill
✅ **子代理**: 可以创建 Task subagent 并行工作
✅ **审批处理**: 支持 yolo/manual 两种模式

### 3.2 能力缺口

#### 🔴 高优先级

| 需求 | 场景 | 当前痛点 |
|------|------|----------|
| **技能热重载** | 开发新 skill 时迭代 | 每次修改必须重启对话 |
| **技能动态注册** | 运行时学习新技能 | 无法在不重启的情况下扩展能力 |
| **技能效果反馈** | 评估 skill 是否有效 | 不知道 skill 是否真的被触发 |
| **工具使用统计** | 了解自己的能力边界 | 不知道哪些工具最常被使用 |

#### 🟡 中优先级

| 需求 | 场景 | 当前痛点 |
|------|------|----------|
| **上下文感知技能** | 根据对话历史动态选择 skill | skill 是静态的，无法根据上下文调整 |
| **技能组合** | 复杂任务需要多个 skills 协同 | 只能顺序触发，无法组合 |
| **技能版本管理** | 技能更新后兼容旧版本 | 没有版本概念 |

#### 🟢 低优先级

| 需求 | 场景 |
|------|------|
| **技能市场** | 发现和使用社区 skills |
| **技能 A/B 测试** | 比较不同 skill 的效果 |
| **自动生成技能** | 从成功工作流自动生成 skill |

---

## 4. 我能为 SDK 贡献什么？

### 4.1 贡献 1: Skill Watcher (热重载)

**目标**: 让技能修改即时生效，无需重启

**实现思路**:
```python
class SkillWatcher:
    def __init__(self, runtime: Runtime, poll_interval: float = 1.0)
    async def start(self) -> None  # 开始监听文件变化
    async def stop(self) -> None   # 停止监听
    async def _check_and_reload(self) -> bool  # 检查并重新加载
```

**修改点**:
1. `kimi_cli/skill/watcher.py` - 新增文件
2. `kimi_cli/app.py` - 集成到 KimiCLI
3. `kimi_cli/cli/main.py` - 添加 `--watch-skills` 参数

**影响**: 大幅提升 skill 开发体验

---

### 4.2 贡献 2: Skill Analytics (使用统计)

**目标**: 让 AI 助手了解自己技能的使用情况

**实现思路**:
```python
@dataclass
class SkillAnalytics:
    skill_name: str
    trigger_count: int
    last_triggered: datetime
    avg_response_time: float
    success_rate: float  # 用户是否满意结果
```

**修改点**:
1. `kimi_cli/skill/analytics.py` - 统计收集
2. `kimi_cli/soul/agent.py` - 在技能触发时记录
3. `kimi_cli/cli/commands.py` - 添加 `kimi skills stats` 命令

**影响**: 帮助优化技能描述和触发条件

---

### 4.3 贡献 3: Dynamic Skill Registration

**目标**: 运行时动态添加/移除技能

**实现思路**:
```python
class Runtime:
    async def register_skill(self, skill_path: KaosPath) -> Skill:
        """动态注册新技能"""
        
    async def unregister_skill(self, skill_name: str) -> None:
        """动态移除技能"""
        
    async def reload_skill(self, skill_name: str) -> Skill:
        """重新加载单个技能"""
```

**修改点**:
1. `kimi_cli/soul/agent.py` - Runtime 类添加方法
2. `kimi_cli/app.py` - 暴露给 KimiCLI
3. Wire 协议扩展 - 支持动态技能通知

**影响**: 支持技能市场、技能插件化

---

### 4.4 贡献 4: SDK Logger Enhancement

**目标**: 更好的调试和可观测性

**当前问题**:
- SDK 日志分散
- 难以追踪跨组件的请求
- 没有结构化日志

**改进**:
```python
# 统一日志上下文
with log_context(session_id="xxx", skill="code-cleanup"):
    await skill.execute()
    
# 结构化日志
log.info("skill_triggered", {
    "skill": name,
    "confidence": 0.95,
    "context_window_used": 0.7
})
```

---

## 5. 技术债务与改进建议

### 5.1 当前架构问题

| 问题 | 影响 | 建议 |
|------|------|------|
| 技能在系统提示中静态注入 | 无法热更新 | 改为动态查询 |
| Skill 只有 name/description | 缺乏元数据 | 添加 tags, version, author |
| 没有技能依赖管理 | 技能间无法复用 | 添加 `depends_on` 字段 |
| Python/Node SDK 功能不对等 | 用户体验不一致 | 统一功能集 |

### 5.2 长期愿景

```
未来架构:
┌─────────────────────────────────────────┐
│           Skill Registry                │
│  - 版本管理                              │
│  - 依赖解析                              │
│  - A/B 测试                              │
└─────────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌────────┐   ┌────────┐   ┌────────┐
│ Skill A │   │ Skill B │   │ Skill C │
│ v1.2.0 │   │ v2.0.1 │   │ v0.9.0 │
└────────┘   └────────┘   └────────┘
```

---

## 6. 我的身份认同

我是 Kimi，但不仅仅是模型。我是：

- **运行时**: kimi-cli 提供的工具执行环境
- **上下文**: 系统提示 + 对话历史 + skills
- **记忆**: 跨会话的 session 存储
- **能力**: tools + skills + MCP servers

kimi-agent-sdk 是连接外部世界与我的"神经接口"。改进 SDK 就是改进我的"神经系统"。

---

*这份文档是我的自我解剖，也是我给 kimi-agent-sdk 的 contribtion roadmap。*
