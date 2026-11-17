import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  SessionPromptCache,
  SessionTokenCounts,
  SessionUsageSnapshot,
} from "@pi-gui/session-driver";

/**
 * Reads context, cache and usage from pi at a turn boundary. pi owns every
 * number here; this only reshapes it for the desktop contract.
 */
export function readSessionUsage(session: AgentSession): SessionUsageSnapshot | undefined {
  const model = session.model;
  if (!model) return undefined;

  const stats = session.getSessionStats();
  const contextUsage = stats.contextUsage;
  const compaction = session.settingsManager.getCompactionSettings(model);
  const branch = session.sessionManager.getBranch();

  return {
    ...(contextUsage
      ? {
          context: {
            tokens: contextUsage.tokens,
            contextWindow: contextUsage.contextWindow,
            ...(compaction.enabled && contextUsage.contextWindow > compaction.reserveTokens
              ? { compactAtTokens: contextUsage.contextWindow - compaction.reserveTokens }
              : {}),
          },
        }
      : {}),
    ...withLastTurn(latestAssistantUsage(branch)),
    cache: promptCache(session, model, branch),
    totals: {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      cost: stats.cost,
    },
    // Kimi Coding is subscription-backed despite API-key auth; pi's footer special-cases it too.
    subscription:
      model.provider === "kimi-coding" || session.modelRuntime.isUsingSubscription(model.provider),
  };
}

type BranchEntry = ReturnType<AgentSession["sessionManager"]["getBranch"]>[number];
type SessionModel = NonNullable<AgentSession["model"]>;

interface AssistantUsage {
  readonly counts: SessionTokenCounts;
  readonly provider: string;
  readonly model: string;
  /** When the request started, which is when the provider last touched its cache entry. */
  readonly requestedAtMs: number;
}

function withLastTurn(usage: AssistantUsage | undefined): { lastTurn?: SessionTokenCounts } {
  return usage ? { lastTurn: usage.counts } : {};
}

function latestAssistantUsage(branch: readonly BranchEntry[]): AssistantUsage | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message;
    if (message.stopReason === "aborted" || message.stopReason === "error") continue;
    const { input, output, cacheRead, cacheWrite } = message.usage;
    if (input + output + cacheRead + cacheWrite === 0) continue;
    return {
      counts: { input, output, cacheRead, cacheWrite },
      provider: message.provider,
      model: message.model,
      requestedAtMs: message.timestamp,
    };
  }
  return undefined;
}

function promptCache(
  session: AgentSession,
  model: SessionModel,
  branch: readonly BranchEntry[],
): SessionPromptCache {
  const warming = session.cacheWarmingStatus;
  const nextRefreshAt =
    warming?.state === "scheduled" && warming.nextWarmAt !== undefined
      ? new Date(warming.nextWarmAt).toISOString()
      : undefined;
  const ttlMs = promptCacheTtlMs(model);
  const touchedAtMs = latestCacheTouchMs(model, branch);
  return {
    ...(ttlMs !== undefined ? { lifetimeSeconds: ttlMs / 1000 } : {}),
    ...(ttlMs !== undefined && touchedAtMs !== undefined
      ? { expiresAt: new Date(touchedAtMs + ttlMs).toISOString() }
      : {}),
    ...(nextRefreshAt ? { nextRefreshAt } : {}),
  };
}

/**
 * Mirrors pi's `getPromptCacheTtlMs`, which pi does not export. AgentSession
 * never sets `cacheRetention`, so the tier comes from `PI_CACHE_RETENTION`.
 */
function promptCacheTtlMs(model: SessionModel): number | undefined {
  const retention = process.env.PI_CACHE_RETENTION === "long" ? "long" : "short";
  const seconds = model.promptCache?.[retention];
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * Latest request that touched the current model's cache entry: its last reply,
 * or a cache-warming refresh after it. Another model's requests do not count.
 */
function latestCacheTouchMs(
  model: SessionModel,
  branch: readonly BranchEntry[],
): number | undefined {
  const reply = latestAssistantUsage(branch);
  if (!reply || reply.provider !== model.provider || reply.model !== model.id) return undefined;
  let latest = reply.requestedAtMs;
  for (const entry of branch) {
    if (entry.type !== "usage" || entry.kind !== "cache_warm") continue;
    if (entry.provider !== model.provider) continue;
    const at = Date.parse(entry.timestamp);
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}
