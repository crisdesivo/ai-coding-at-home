import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface ScriptedChatMessage {
  readonly role: string;
  readonly content: string;
}

export interface ScriptedChatRequest {
  readonly messages: readonly ScriptedChatMessage[];
  readonly toolNames: readonly string[];
}

/**
 * One model reply: plain text, or a single tool call that pi runs before asking again, or an
 * HTTP error. Text can end like a full local context does (`finishReason: "length"`, with the
 * token counts in `usage`) and can wait `delayMs` before answering. A tool call can stream its
 * arguments slowly like a small local model: `streamChunks` pieces, `chunkDelayMs` apart.
 */
export type ScriptedReply =
  | {
      readonly text: string;
      readonly finishReason?: "stop" | "length";
      readonly usage?: { readonly prompt: number; readonly completion: number };
      readonly delayMs?: number;
    }
  | {
      readonly tool: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly delayMs?: number;
      readonly streamChunks?: number;
      readonly chunkDelayMs?: number;
    }
  | { readonly httpStatus: number; readonly error: string };

/** pi's request to summarize older messages (compaction), not a turn of the conversation. */
export function isSummaryRequest(request: ScriptedChatRequest): boolean {
  return request.messages.some(
    (message) =>
      message.role === "system" && message.content.includes("context summarization assistant"),
  );
}

export interface ScriptedOpenAiServer {
  readonly baseUrl: string;
  readonly requests: readonly ScriptedChatRequest[];
  readonly close: () => Promise<void>;
}

/**
 * An OpenAI-compatible chat endpoint whose replies a test scripts from the request, so a
 * real pi agent loop runs real tools without a provider login.
 */
export async function startScriptedOpenAiServer(
  reply: (request: ScriptedChatRequest) => ScriptedReply,
): Promise<ScriptedOpenAiServer> {
  const requests: ScriptedChatRequest[] = [];
  let calls = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as {
        messages?: { role: string; content: unknown }[];
        tools?: { function?: { name?: string } }[];
      };
      const scripted: ScriptedChatRequest = {
        messages: (payload.messages ?? []).map((message) => ({
          role: message.role,
          content: contentText(message.content),
        })),
        toolNames: (payload.tools ?? []).flatMap((tool) =>
          tool.function?.name ? [tool.function.name] : [],
        ),
      };
      requests.push(scripted);
      const next = reply(scripted);
      if ("httpStatus" in next) {
        response.writeHead(next.httpStatus, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: next.error, type: "server_error" } }));
        return;
      }
      const delayMs = "delayMs" in next ? (next.delayMs ?? 0) : 0;
      setTimeout(() => respond(next), delayMs);
    });
    const respond = (next: Exclude<ScriptedReply, { httpStatus: number }>) => {
      // The app may have stopped the run while the reply waited.
      if (response.destroyed) return;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      /** Writes one SSE chunk; false once the app has closed the request (Stop). */
      const chunk = (delta: unknown, finishReason: string | null): boolean => {
        if (response.destroyed || response.writableEnded) return false;
        response.write(
          `data: ${JSON.stringify({
            id: "scripted",
            object: "chat.completion.chunk",
            model: "scripted",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
        return true;
      };
      if ("tool" in next && (next.streamChunks ?? 1) > 1) {
        calls += 1;
        streamToolCall(next, `scripted-call-${calls}`, chunk, () => {
          if (!response.destroyed && !response.writableEnded) response.end("data: [DONE]\n\n");
        });
        return;
      }
      if ("tool" in next) {
        calls += 1;
        chunk(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `scripted-call-${calls}`,
                type: "function",
                function: { name: next.tool, arguments: JSON.stringify(next.args) },
              },
            ],
          },
          null,
        );
        chunk({}, "tool_calls");
      } else {
        chunk({ role: "assistant", content: next.text }, null);
        chunk({}, next.finishReason ?? "stop");
        if (next.usage) {
          response.write(
            `data: ${JSON.stringify({
              id: "scripted",
              object: "chat.completion.chunk",
              model: "scripted",
              choices: [],
              usage: {
                prompt_tokens: next.usage.prompt,
                completion_tokens: next.usage.completion,
                total_tokens: next.usage.prompt + next.usage.completion,
              },
            })}\n\n`,
          );
        }
      }
      response.end("data: [DONE]\n\n");
    };
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Sends a tool call's arguments in pieces, like a slow model streaming tokens. */
function streamToolCall(
  next: Extract<ScriptedReply, { tool: string }>,
  id: string,
  chunk: (delta: unknown, finishReason: string | null) => boolean,
  end: () => void,
): void {
  const json = JSON.stringify(next.args);
  const count = Math.max(1, next.streamChunks ?? 1);
  const size = Math.ceil(json.length / count);
  const pieces = Array.from({ length: count }, (_, index) =>
    json.slice(index * size, (index + 1) * size),
  ).filter((piece) => piece.length > 0);
  chunk(
    {
      role: "assistant",
      tool_calls: [
        { index: 0, id, type: "function", function: { name: next.tool, arguments: "" } },
      ],
    },
    null,
  );
  let sent = 0;
  const sendNext = () => {
    const piece = pieces[sent];
    if (piece === undefined) {
      chunk({}, "tool_calls");
      end();
      return;
    }
    sent += 1;
    // Stop when the app aborted the request (Stop).
    if (!chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }, null)) return;
    setTimeout(sendNext, next.chunkDelayMs ?? 0);
  };
  sendNext();
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        const text = typeof part === "object" && part ? (part as { text?: unknown }).text : "";
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}
