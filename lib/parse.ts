import type { NotebookCell } from "./types";

/** Marker the API route appends to the stream if the upstream call fails mid-way. */
export const STREAM_ERROR_MARKER = "\n[[ERROR]] ";

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[\w-]*\s*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : t;
}

function toSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join("");
  return "";
}

/** Reduce markdown to plain text: the notebook shows descriptions as unformatted text. */
function plainText(md: string): string {
  return md
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
    )
    .join("\n")
    .trim();
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Tolerantly extract notebook cells from a model response. */
export function parseCells(raw: string): NotebookCell[] {
  const text = stripFences(raw);
  let data = tryJson(text);
  if (data === undefined) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) data = tryJson(text.slice(start, end + 1));
  }
  if (data === undefined) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end > start) data = tryJson(text.slice(start, end + 1));
  }

  const list: unknown = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? (data as { cells?: unknown }).cells
      : undefined;
  if (!Array.isArray(list)) return [];

  const cells: NotebookCell[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.cell_type ?? obj.type;
    const source = toSource(obj.source ?? obj.content);
    if (type === "code") {
      const code = stripFences(source).replace(/\s+$/, "");
      if (code) cells.push({ cell_type: "code", source: code });
    } else if (type === "markdown" || type === "text") {
      const md = plainText(source);
      if (md) cells.push({ cell_type: "markdown", source: md });
    }
  }
  return cells;
}
