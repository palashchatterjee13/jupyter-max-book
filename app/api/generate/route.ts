import OpenAI from "openai";
import { buildMessages, sanitizeHistory, sanitizePrompt, type ChatMessage } from "@/lib/llm";
import { STREAM_ERROR_MARKER } from "@/lib/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long notebooks can take a while; Vercel clamps this to the plan's limit.
export const maxDuration = 300;

const DEFAULT_MAX_TOKENS = 32768;

type TokenParam = "max_tokens" | "max_completion_tokens" | "none";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function openStream(client: OpenAI, model: string, messages: ChatMessage[], maxTokens: number) {
  // Providers differ on which output-limit parameter they accept, so fall back on 400s.
  const attempts: TokenParam[] = ["max_tokens", "max_completion_tokens", "none"];
  let lastError: unknown;
  for (const param of attempts) {
    try {
      return await client.chat.completions.create({
        model,
        messages,
        stream: true,
        ...(param === "none" ? {} : { [param]: maxTokens }),
      });
    } catch (err) {
      lastError = err;
      if (!(err instanceof OpenAI.APIError) || err.status !== 400) throw err;
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    return jsonError("Server is missing OPENAI_API_KEY or OPENAI_MODEL.", 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const { prompt: rawPrompt, history: rawHistory } = (body ?? {}) as Record<string, unknown>;
  const prompt = sanitizePrompt(rawPrompt);
  if (!prompt) return jsonError("Prompt is empty.", 400);

  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const messages = buildMessages(sanitizeHistory(rawHistory), prompt);

  let stream: Awaited<ReturnType<typeof openStream>>;
  try {
    stream = await openStream(client, model, messages, maxTokens);
  } catch (err) {
    const status = err instanceof OpenAI.APIError && err.status ? err.status : 502;
    const message = err instanceof Error ? err.message : "Model request failed.";
    return jsonError(message, status);
  }

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream interrupted.";
        controller.enqueue(encoder.encode(STREAM_ERROR_MARKER + message));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.controller.abort();
    },
  });

  return new Response(body$, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
