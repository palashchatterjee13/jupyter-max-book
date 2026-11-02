import type { HistoryTurn, NotebookCell } from "./types";

export const SYSTEM_PROMPT = `You are the engine behind a Jupyter notebook where the user types natural-language prompts instead of code.
For every prompt you produce a COMPLETE Jupyter notebook of Python code.

Rules:
- Respond with JSON only, no prose and no code fences, exactly in this shape:
  {"cells":[{"cell_type":"markdown","source":"..."},{"cell_type":"code","source":"..."}]}
- Always return the ENTIRE updated notebook, not a diff. Carry forward all relevant earlier code, apply the requested changes, and fix any errors or bugs the user mentions or that you notice.
- Precede every code cell with exactly one markdown cell containing one or two short plain-text sentences describing what the code cell below does.
- Markdown cells must be plain text only: no headings, no bold or italics, no bullet lists, no links, no backticks.
- Code cells must contain valid, runnable Python. Split code into logical cells, put imports in the first code cell, and do not wrap code in markdown fences.
- Do not use seaborn. For visualizations use matplotlib and never import seaborn.
- Do not include cell outputs.`;

const MAX_TURNS = 8;
const MAX_PROMPT_CHARS = 20_000;
const MAX_CELL_CHARS = 60_000;
const MAX_CELLS = 400;

/** Gemini conversation turn: earlier notebooks are replayed as "model" replies. */
export type ChatContent = { role: "user" | "model"; parts: { text: string }[] };

/** Validate and cap untrusted history coming from the browser. */
export function sanitizeHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: HistoryTurn[] = [];
  for (const t of value.slice(-MAX_TURNS)) {
    if (!t || typeof t !== "object") continue;
    const { prompt, cells } = t as { prompt?: unknown; cells?: unknown };
    const safeCells: NotebookCell[] = [];
    if (Array.isArray(cells)) {
      for (const c of cells.slice(0, MAX_CELLS)) {
        if (!c || typeof c !== "object") continue;
        const { cell_type, source } = c as { cell_type?: unknown; source?: unknown };
        if ((cell_type === "code" || cell_type === "markdown") && typeof source === "string") {
          safeCells.push({ cell_type, source: source.slice(0, MAX_CELL_CHARS) });
        }
      }
    }
    turns.push({
      prompt: typeof prompt === "string" ? prompt.slice(0, MAX_PROMPT_CHARS) : "",
      cells: safeCells,
    });
  }
  return turns;
}

export function sanitizePrompt(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_PROMPT_CHARS) : "";
}

export function buildContents(history: HistoryTurn[], prompt: string): ChatContent[] {
  const contents: ChatContent[] = [];
  for (const turn of history) {
    contents.push({ role: "user", parts: [{ text: turn.prompt || "(earlier request)" }] });
    contents.push({ role: "model", parts: [{ text: JSON.stringify({ cells: turn.cells }) }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });
  return contents;
}
