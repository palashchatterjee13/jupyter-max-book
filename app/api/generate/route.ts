import { ApiError, GoogleGenAI } from "@google/genai";
import { buildContents, sanitizeHistory, sanitizePrompt, SYSTEM_PROMPT } from "@/lib/llm";
import { STREAM_ERROR_MARKER } from "@/lib/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long notebooks can take a while; Vercel clamps this to the plan's limit.
export const maxDuration = 300;

const DEFAULT_MAX_TOKENS = 32768;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    return jsonError("Server is missing GEMINI_API_KEY or GEMINI_MODEL.", 500);
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

  const maxTokens = Number(process.env.GEMINI_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const ai = new GoogleGenAI({ apiKey });
  const contents = buildContents(sanitizeHistory(rawHistory), prompt);
  const abort = new AbortController();

  let stream: Awaited<ReturnType<typeof ai.models.generateContentStream>>;
  try {
    stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: maxTokens,
        abortSignal: abort.signal,
      },
    });
  } catch (err) {
    const status = err instanceof ApiError && err.status ? err.status : 502;
    const message = err instanceof Error ? err.message : "Model request failed.";
    return jsonError(message, status);
  }

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.text;
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
      abort.abort();
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
