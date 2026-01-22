import * as crypto from "node:crypto";
import { ProtocolClient } from "./protocol";
import { SessionError } from "./errors";
import { log } from "./logger";
import type { SessionOptions, ContentPart, StreamEvent, RunResult, ApprovalResponse, SlashCommandInfo, ExternalTool } from "./schema";

export type SessionState = "idle" | "active" | "closed";

/** Active Configuration Snapshot */
interface ActiveConfig {
  model: string | undefined;
  thinking: boolean;
  yoloMode: boolean;
  executable: string;
  env: string; // JSON stringified for comparison
  externalTools: string;
}

/** Turn interface, represents a single conversation turn */
export interface Turn {
  /** Asynchronous iterator of event stream, returns RunResult upon completion */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent, RunResult, undefined>;
  /** Interrupt the current turn, clearing the message queue */
  interrupt(): Promise<void>;
  /** Respond to approval request */
  approve(requestId: string, response: ApprovalResponse): Promise<void>;
  /** Promise of the result after the turn is completed */
  readonly result: Promise<RunResult>;
}

/** Session interface, represents a persistent connection with Kimi Code */
export interface Session {
  /** Session ID */
  readonly sessionId: string;
  /** Working directory */
  readonly workDir: string;
  /** Current state: idle | active | closed */
  readonly state: SessionState;
  // Slash commands available in this session
  readonly slashCommands: SlashCommandInfo[];

  model: string | undefined;
  /** Whether thinking mode is enabled, can be changed between turns */
  thinking: boolean;
  /** Whether to automatically approve actions, can be changed between turns */
  yoloMode: boolean;
  /** CLI executable path, can be changed between turns */
  executable: string;
  /** Environment variables, can be changed between turns */
  env: Record<string, string>;
  // Exported external tools
  externalTools: ExternalTool[];
  /** Send a message, returns a Turn object */
  prompt(content: string | ContentPart[]): Turn;
  /** Close the session, release resources */
  close(): Promise<void>;
  /** Supports using syntax for automatic closure */
  [Symbol.asyncDispose](): Promise<void>;
}

class TurnImpl implements Turn {
  readonly result: Promise<RunResult>;
  private resolveResult: (result: RunResult) => void;
  private rejectResult: (error: Error) => void;
  private interrupted = false;

  constructor(
    private getClient: () => Promise<ProtocolClient>,
    private getCurrentClient: () => ProtocolClient | null,
    private getNextPending: () => (string | ContentPart[]) | undefined,
    private clearPending: () => void,
    private onComplete: () => void,
  ) {
    let resolve!: (result: RunResult) => void;
    let reject!: (error: Error) => void;
    this.result = new Promise<RunResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.result.catch(() => {});
    this.resolveResult = resolve;
    this.rejectResult = reject;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent, RunResult, undefined> {
    try {
      let result: RunResult | undefined;
      let content: string | ContentPart[] | undefined;
      while (!this.interrupted && (content = this.getNextPending()) !== undefined) {
        result = yield* this.processOne(content);
      }
      this.onComplete();
      this.resolveResult(result!);
      return result!;
    } catch (err) {
      this.onComplete();
      this.rejectResult(err as Error);
      throw err;
    }
  }

  private async *processOne(content: string | ContentPart[]): AsyncGenerator<StreamEvent, RunResult, undefined> {
    const client = await this.getClient();
    const stream = client.sendPrompt(content);
    for await (const event of stream.events) {
      yield event;
    }
    return await stream.result;
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    this.clearPending();
    const client = this.getCurrentClient();
    if (client?.isRunning) {
      return client.sendCancel();
    }
  }

  async approve(requestId: string, response: ApprovalResponse): Promise<void> {
    const client = this.getCurrentClient();
    if (!client?.isRunning) {
      throw new SessionError("SESSION_CLOSED", "Cannot approve: no active client");
    }
    return client.sendApproval(requestId, response);
  }
}

class SessionImpl implements Session {
  private readonly _sessionId: string;
  private readonly _workDir: string;
  private _model: string | undefined;
  private _thinking: boolean;
  private _yoloMode: boolean;
  private _executable: string;
  private _env: Record<string, string>;
  private _externalTools: ExternalTool[];
  private _slashCommands: SlashCommandInfo[] = [];

  private _state: SessionState = "idle";

  private client: ProtocolClient | null = null;
  private activeConfig: ActiveConfig | null = null;
  private currentTurn: TurnImpl | null = null;
  private pendingMessages: (string | ContentPart[])[] = [];

  constructor(options: SessionOptions) {
    this._sessionId = options.sessionId ?? crypto.randomUUID();
    this._workDir = options.workDir;
    this._model = options.model;
    this._thinking = options.thinking ?? false;
    this._yoloMode = options.yoloMode ?? false;
    this._executable = options.executable ?? "kimi";
    this._env = options.env ?? {};
    this._externalTools = options.externalTools ?? [];

    log.session("Created session %s in %s", this._sessionId, this._workDir);
  }

  get sessionId(): string {
    return this._sessionId;
  }
  get workDir(): string {
    return this._workDir;
  }
  get state(): SessionState {
    return this._state;
  }
  get slashCommands(): SlashCommandInfo[] {
    return this._slashCommands;
  }
  get model(): string | undefined {
    return this._model;
  }
  set model(v: string | undefined) {
    this._model = v;
  }
  get thinking(): boolean {
    return this._thinking;
  }
  set thinking(v: boolean) {
    this._thinking = v;
  }
  get yoloMode(): boolean {
    return this._yoloMode;
  }
  set yoloMode(v: boolean) {
    this._yoloMode = v;
  }
  get executable(): string {
    return this._executable;
  }
  set executable(v: string) {
    this._executable = v;
  }
  get env(): Record<string, string> {
    return this._env;
  }
  set env(v: Record<string, string>) {
    this._env = v;
  }
  get externalTools(): ExternalTool[] {
    return this._externalTools;
  }
  set externalTools(v: ExternalTool[]) {
    this._externalTools = v;
  }

  prompt(content: string | ContentPart[]): Turn {
    if (this._state === "closed") {
      throw new SessionError("SESSION_CLOSED", "Session is closed");
    }

    this.pendingMessages.push(content);
    log.session("Queued prompt, pending: %d", this.pendingMessages.length);

    if (this._state === "active" && this.currentTurn) {
      return this.currentTurn;
    }

    this._state = "active";
    this.currentTurn = new TurnImpl(
      () => this.getClientWithConfigCheck(),
      () => this.client,
      () => this.pendingMessages.shift(),
      () => {
        this.pendingMessages = [];
      },
      () => {
        if (this._state === "active") {
          this._state = "idle";
        }
        this.currentTurn = null;
        log.session("Turn completed, state: %s", this._state);
      },
    );

    return this.currentTurn;
  }

  async close(): Promise<void> {
    if (this._state === "closed") {
      return;
    }

    log.session("Closing session %s", this._sessionId);
    this._state = "closed";
    this.currentTurn = null;
    this.pendingMessages = [];

    if (this.client) {
      try {
        await this.client.stop();
      } catch (err) {
        log.session("Error during close: %O", err);
      }
      this.client = null;
      this.activeConfig = null;
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async getClientWithConfigCheck(): Promise<ProtocolClient> {
    const currentConfig = this.snapshotConfig();

    if (this.client?.isRunning && this.activeConfig && !this.configChanged(currentConfig)) {
      return this.client;
    }

    // Config changed or no client, restart
    if (this.client) {
      log.session("Config changed, restarting client");
      await this.client.stop();
      this.client = null;
    }

    this.client = new ProtocolClient();
    const initResult = await this.client.start({
      sessionId: this._sessionId,
      workDir: this._workDir,
      model: this._model,
      thinking: this._thinking,
      yoloMode: this._yoloMode,
      executablePath: this._executable,
      environmentVariables: this._env,
      externalTools: this._externalTools,
    });

    this._slashCommands = initResult.slash_commands;
    this.activeConfig = currentConfig;

    return this.client;
  }

  private snapshotConfig(): ActiveConfig {
    return {
      model: this._model,
      thinking: this._thinking,
      yoloMode: this._yoloMode,
      executable: this._executable,
      env: JSON.stringify(this._env),
      externalTools: JSON.stringify(this._externalTools.map((t) => t.name)),
    };
  }

  private configChanged(current: ActiveConfig): boolean {
    const active = this.activeConfig!;
    return (
      current.model !== active.model ||
      current.thinking !== active.thinking ||
      current.yoloMode !== active.yoloMode ||
      current.executable !== active.executable ||
      current.env !== active.env ||
      current.externalTools !== active.externalTools
    );
  }
}

/** Start New Session */
export function createSession(options: SessionOptions): Session {
  return new SessionImpl(options);
}

/** One-time run: create session, send message, collect all events, and automatically close session after returning result */
export async function prompt(content: string | ContentPart[], options: Omit<SessionOptions, "sessionId">): Promise<{ result: RunResult; events: StreamEvent[] }> {
  const session = createSession(options);
  try {
    const turn = session.prompt(content);
    const events: StreamEvent[] = [];
    for await (const event of turn) {
      events.push(event);
    }
    return { result: await turn.result, events };
  } finally {
    await session.close();
  }
}
