import type { NotebookCell } from "./types";

function cellId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function splitLines(source: string): string[] {
  return source.split(/(?<=\n)/);
}

/** Build an nbformat 4.5 notebook from cells. */
export function toIpynb(cells: NotebookCell[]) {
  return {
    cells: cells.map((c) =>
      c.cell_type === "code"
        ? {
            cell_type: "code",
            execution_count: null,
            id: cellId(),
            metadata: {},
            outputs: [],
            source: splitLines(c.source),
          }
        : { cell_type: "markdown", id: cellId(), metadata: {}, source: splitLines(c.source) },
    ),
    metadata: {
      kernelspec: { display_name: "Python 3 (ipykernel)", language: "python", name: "python3" },
      language_info: { name: "python", pygments_lexer: "ipython3" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Untitled";
}

export function downloadIpynb(cells: NotebookCell[], filename: string) {
  const blob = new Blob([JSON.stringify(toIpynb(cells), null, 1) + "\n"], {
    type: "application/x-ipynb+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ipynb") ? filename : `${filename}.ipynb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
