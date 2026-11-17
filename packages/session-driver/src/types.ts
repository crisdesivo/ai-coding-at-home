import type { SessionUsageSnapshot } from "./usage.js";
import type {
  SessionTranscriptCard,
  SessionTranscriptCustomMessage,
  SessionTranscriptPin,
} from "./transcript.js";

export type WorkspaceId = string;
export type SessionId = string;
export type RunId = string;
export type Timestamp = string;

export interface WorkspaceRef {
  readonly workspaceId: WorkspaceId;
  readonly path: string;
  readonly displayName?: string;
}

export interface SessionRef {
  readonly workspaceId: WorkspaceId;
  readonly sessionId: SessionId;
}

export type SessionStatus = "idle" | "running" | "failed";

export type SessionMessageDeliveryMode = "steer" | "followUp";

export interface SessionQueuedMessage {
  readonly id: string;
  readonly mode: SessionMessageDeliveryMode;
  readonly text: string;
  readonly attachments?: readonly SessionAttachment[];
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * How the newest assistant reply ended, from pi's stop reason: "completed" for a normal
 * stop, "stopped" when the run was aborted (including a user stop), "failed" for an
 * error, "incomplete" when it was cut off by length or ended on a tool call.
 */
export type SessionRunOutcome = "completed" | "stopped" | "failed" | "incomplete";

export interface SessionSnapshot {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
  readonly status: SessionStatus;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly preview?: string;
  readonly config?: SessionConfig;
  readonly runningRunId?: RunId;
  readonly queuedMessages?: readonly SessionQueuedMessage[];
  readonly usage?: SessionUsageSnapshot;
  /** Absent until the session has an assistant reply. */
  readonly lastRunOutcome?: SessionRunOutcome;
}

export interface SessionImageAttachment {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: string;
  readonly name?: string;
}

export interface SessionFileAttachment {
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type SessionAttachment = SessionImageAttachment | SessionFileAttachment;

export interface SessionConfig {
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
}

export type SessionTreeNodeKind =
  | "message"
  | "thinking_level_change"
  | "model_change"
  | "usage"
  | "context_edit"
  | "compaction"
  | "branch_summary"
  | "custom"
  | "custom_message"
  | "label"
  | "session_info";

export interface SessionTreeNodeSnapshot {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: SessionTreeNodeKind;
  readonly timestamp: Timestamp;
  readonly label?: string;
  readonly role?: string;
  readonly customType?: string;
  readonly title: string;
  readonly preview?: string;
}

/**
 * The session tree as a flat list, in depth-first order: every parent comes before its
 * children, and siblings run oldest first. A node whose parentId is null, its own id, or not
 * in the list is a root. It is flat on purpose: Electron's contextBridge refuses values nested more than
 * 1000 levels deep, and a nested tree gains a level per entry on its longest path.
 */
export interface SessionTreeSnapshot {
  readonly nodes: readonly SessionTreeNodeSnapshot[];
  readonly leafId: string | null;
}

export interface NavigateSessionTreeOptions {
  readonly summarize?: boolean;
  readonly customInstructions?: string;
}

export interface NavigateSessionTreeResult {
  readonly cancelled: boolean;
  readonly aborted?: boolean;
  readonly editorText?: string;
  readonly summaryCreated?: boolean;
}

export interface SessionModelSelection {
  readonly provider: string;
  readonly modelId: string;
}

export interface SessionMessageInput {
  readonly text: string;
  readonly attachments?: readonly SessionAttachment[];
  readonly deliverAs?: SessionMessageDeliveryMode;
  /**
   * Refuse the message unless it runs a command an extension registered. Set for commands
   * that come from an extension's button, so a button can never start a model turn.
   */
  readonly extensionCommandOnly?: boolean;
}

export interface CreateSessionOptions {
  readonly title?: string;
  readonly initialModel?: SessionModelSelection;
  readonly initialThinkingLevel?: string;
  /** Values for flags the session's extensions registered, applied when pi loads them. */
  readonly extensionFlagValues?: ExtensionFlagValues;
}

/** Extension flag values by flag name, as `pi --name` (boolean) or `pi --name value` (string). */
export type ExtensionFlagValues = Readonly<Record<string, boolean | string>>;

export type ForkPosition = "before" | "at" | "after";

export interface ForkSessionOptions {
  /** Target workspace for the forked session (the source workspace, or a new worktree). */
  readonly targetWorkspace: WorkspaceRef;
  /** ID of the rendered source message selected as the fork point, when it maps to a session entry. */
  readonly sourceMessageId?: string;
  /** 0-based index of the rendered source message selected as the fork point. */
  readonly sourceMessageIndex?: number;
  /** 0-based rendered user-message index kept as a fallback for older callers. */
  readonly userMessageIndex?: number;
  /**
   * "before" (default) forks before the selected user message so it can be edited and
   * re-sent; "at" keeps the selected user message in the forked history.
   */
  readonly position?: ForkPosition;
  /** Optional title for the forked session. Defaults to the source session title. */
  readonly title?: string;
  /** Flag values for the fork's pi session, normally the ones the source started with. */
  readonly extensionFlagValues?: ExtensionFlagValues;
}

export interface ForkSessionResult {
  readonly snapshot: SessionSnapshot;
  /** When forking "before", the text of the selected user message for composer prefill. */
  readonly selectedText?: string;
}

export interface SessionEventBase {
  readonly type: string;
  readonly sessionRef: SessionRef;
  readonly timestamp: Timestamp;
  readonly runId?: RunId;
}

export interface SessionOpenedEvent extends SessionEventBase {
  readonly type: "sessionOpened";
  readonly snapshot: SessionSnapshot;
}

export interface SessionUpdatedEvent extends SessionEventBase {
  readonly type: "sessionUpdated";
  readonly snapshot: SessionSnapshot;
}

export interface AssistantDeltaEvent extends SessionEventBase {
  readonly type: "assistantDelta";
  readonly text: string;
}

/**
 * What a running turn is doing right now. File and command text come from the
 * arguments the model is still streaming, so they may be cut short.
 */
export type RunProgressActivity =
  /** The request is sent and no output has arrived yet (a local model reads the prompt first). */
  | { readonly kind: "waiting" }
  | { readonly kind: "thinking" }
  | { readonly kind: "replying" }
  /** A tool call is streaming and its target is not known (yet). */
  | { readonly kind: "writingToolCall"; readonly toolName: string }
  /** A write/edit call, or a bash heredoc into a file, is streaming. */
  | { readonly kind: "writingFile"; readonly toolName: string; readonly fileName: string }
  /** A tool is executing; `detail` is the bash command or the file it works on. */
  | { readonly kind: "runningTool"; readonly toolName: string; readonly detail?: string };

export interface RunProgress {
  readonly activity: RunProgressActivity;
  /** When the current step (one model reply, or one tool execution) started. */
  readonly stepStartedAt: Timestamp;
  /** Tokens the model produced in this step: streamed deltas, or the provider's count if higher. */
  readonly stepTokens: number;
  /** Average output speed of this step once it has at least two tokens. */
  readonly tokensPerSecond?: number;
  /** When the model last produced output in this run; absent before the first token. */
  readonly lastOutputAt?: Timestamp;
}

/** Live progress of a running turn. Throttled by the driver (a few per second at most). */
export interface RunProgressEvent extends SessionEventBase {
  readonly type: "runProgress";
  readonly progress: RunProgress;
}

/** Finalizes one assistant message while the containing run may continue. */
export interface AssistantMessageEndedEvent extends SessionEventBase {
  readonly type: "assistantMessageEnded";
}

/** Identifies the immediately preceding ended assistant message after Pi persists it. */
export interface AssistantMessagePersistedEvent extends SessionEventBase {
  readonly type: "assistantMessagePersisted";
  readonly sourceMessageId: string;
}

/**
 * A persisted transcript item that arrives outside the assistant stream: an extension's custom
 * message, card or pin. `item.id` matches the item a later reload projects.
 */
export interface TranscriptItemAppendedEvent extends SessionEventBase {
  readonly type: "transcriptItemAppended";
  readonly item: SessionTranscriptCustomMessage | SessionTranscriptCard | SessionTranscriptPin;
}

export interface QueuedMessageStartedEvent extends SessionEventBase {
  readonly type: "queuedMessageStarted";
  readonly message: SessionQueuedMessage;
}

export interface ToolStartedEvent extends SessionEventBase {
  readonly type: "toolStarted";
  readonly toolName: string;
  readonly callId: string;
  readonly input?: unknown;
}

export interface ToolUpdatedEvent extends SessionEventBase {
  readonly type: "toolUpdated";
  readonly callId: string;
  readonly text?: string;
  readonly progress?: number;
}

export interface ToolFinishedEvent extends SessionEventBase {
  readonly type: "toolFinished";
  readonly callId: string;
  readonly success: boolean;
  readonly output?: unknown;
}

export interface RunCompletedEvent extends SessionEventBase {
  readonly type: "runCompleted";
  readonly snapshot: SessionSnapshot;
}

export interface SessionErrorInfo {
  readonly message: string;
  readonly code?: string;
  readonly details?: unknown;
}

export interface ExtensionCompatibilityIssue {
  readonly capability: string;
  readonly classification: "terminal-only";
  readonly message: string;
  readonly extensionPath?: string;
  readonly eventName?: string;
}

export interface RunFailedEvent extends SessionEventBase {
  readonly type: "runFailed";
  readonly error: SessionErrorInfo;
}

/**
 * `SessionErrorInfo.code` values for runs that ended without a usable reply. pi's own stop
 * reasons ("ERROR", "ABORTED") are passed through upper-cased.
 */
export const RUN_FAILURE_CODES = {
  /** The model hit its output limit before writing anything: the conversation ran out of room. */
  outOfRoom: "OUT_OF_ROOM",
  /** pi could not summarize older messages to make room (automatic compaction failed). */
  compactionFailed: "COMPACTION_FAILED",
  /** The turn ended with no text and no tool call since the person's last message. */
  noReply: "NO_REPLY",
} as const;

export type CompactionReason = "manual" | "threshold" | "overflow";

/** pi started summarizing older messages to make room (compacting). */
export interface CompactionStartedEvent extends SessionEventBase {
  readonly type: "compactionStarted";
  readonly reason: CompactionReason;
}

/** pi finished summarizing older messages (compacting), or gave up. */
export interface CompactionEndedEvent extends SessionEventBase {
  readonly type: "compactionEnded";
  /** `manual` is /compact; `threshold` and `overflow` are pi's automatic compactions. */
  readonly reason: CompactionReason;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly errorMessage?: string;
  /** pi retries the interrupted turn after this compaction (overflow recovery). */
  readonly willRetry: boolean;
}

export type HostUiResponse =
  | {
      readonly requestId: string;
      readonly value: string;
    }
  | {
      readonly requestId: string;
      readonly confirmed: boolean;
    }
  | {
      readonly requestId: string;
      readonly cancelled: true;
    };

export type HostUiRequest =
  | {
      readonly kind: "confirm";
      readonly requestId: string;
      readonly title: string;
      readonly message: string;
      readonly defaultValue?: boolean;
      readonly timeoutMs?: number;
    }
  | {
      readonly kind: "input";
      readonly requestId: string;
      readonly title: string;
      readonly placeholder?: string;
      readonly initialValue?: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly kind: "select";
      readonly requestId: string;
      readonly title: string;
      readonly options: readonly string[];
      readonly allowMultiple?: boolean;
      readonly timeoutMs?: number;
    }
  | {
      readonly kind: "editor";
      readonly requestId: string;
      readonly title: string;
      readonly initialValue?: string;
    }
  | {
      readonly kind: "notify";
      readonly requestId: string;
      readonly message: string;
      readonly level?: "info" | "warning" | "error";
    }
  | {
      readonly kind: "status";
      readonly requestId: string;
      readonly key: string;
      readonly text?: string;
    }
  | {
      readonly kind: "widget";
      readonly requestId: string;
      readonly key: string;
      readonly lines?: readonly string[];
      readonly placement?: "aboveComposer" | "belowComposer";
    }
  | {
      readonly kind: "title";
      readonly requestId: string;
      readonly title: string;
    }
  | {
      readonly kind: "editorText";
      readonly requestId: string;
      readonly text: string;
    }
  | {
      readonly kind: "reset";
      readonly requestId: string;
    }
  | {
      /** pi closed the dialog with this `requestId` itself, such as a sign-in that finished. */
      readonly kind: "dismiss";
      readonly requestId: string;
    };

export interface HostUiRequestEvent extends SessionEventBase {
  readonly type: "hostUiRequest";
  readonly request: HostUiRequest;
}

export interface ExtensionCompatibilityIssueEvent extends SessionEventBase {
  readonly type: "extensionCompatibilityIssue";
  readonly issue: ExtensionCompatibilityIssue;
}

export interface SessionClosedEvent extends SessionEventBase {
  readonly type: "sessionClosed";
  readonly reason: "manual" | "ended" | "failed";
}

export type SessionDriverEvent =
  | SessionOpenedEvent
  | SessionUpdatedEvent
  | AssistantDeltaEvent
  | RunProgressEvent
  | AssistantMessageEndedEvent
  | AssistantMessagePersistedEvent
  | TranscriptItemAppendedEvent
  | QueuedMessageStartedEvent
  | ToolStartedEvent
  | ToolUpdatedEvent
  | ToolFinishedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | CompactionStartedEvent
  | CompactionEndedEvent
  | HostUiRequestEvent
  | ExtensionCompatibilityIssueEvent
  | SessionClosedEvent;

export type SessionEventListener = (event: SessionDriverEvent) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface SessionDriver {
  createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot>;
  validateForkSession(sourceRef: SessionRef, options: ForkSessionOptions): Promise<void>;
  forkSession(sourceRef: SessionRef, options: ForkSessionOptions): Promise<ForkSessionResult>;
  openSession(sessionRef: SessionRef): Promise<SessionSnapshot>;
  archiveSession(sessionRef: SessionRef): Promise<void>;
  unarchiveSession(sessionRef: SessionRef): Promise<void>;
  sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void>;
  replaceQueuedMessages(
    sessionRef: SessionRef,
    messages: readonly SessionQueuedMessage[],
  ): Promise<void>;
  cancelCurrentRun(sessionRef: SessionRef): Promise<void>;
  renameSession(sessionRef: SessionRef, title: string): Promise<void>;
  compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void>;
  reloadSession(sessionRef: SessionRef): Promise<void>;
  getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult>;
  getSessionCommands(
    sessionRef: SessionRef,
  ): Promise<readonly import("./runtime-types.js").RuntimeCommandRecord[]>;
  respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void>;
  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe;
  closeSession(sessionRef: SessionRef): Promise<void>;
}

export interface SessionSchemaInfo {
  /**
   * The session file's header version. `undefined` when the file has no
   * readable session header (e.g. missing/corrupt), in which case skew cannot
   * be determined and is assumed absent.
   */
  readonly fileSchemaVersion: number | undefined;
  /** The bundled runtime's schema version. */
  readonly runtimeSchemaVersion: number;
  /** True when the file was written by a newer pi than the bundled runtime. */
  readonly writtenByNewerRuntime: boolean;
}
