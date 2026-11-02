"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import CellEditor from "./CellEditor";
import MenuBar, { type Menu } from "./MenuBar";
import { Icon, type IconName } from "./Icons";
import JupyterLogo from "./JupyterLogo";
import { parseCells, STREAM_ERROR_MARKER } from "@/lib/parse";
import { downloadIpynb, safeFilename } from "@/lib/ipynb";
import type { GeneratedCell, HistoryTurn, NotebookCell, UICell } from "@/lib/types";

const INPUT_ID = "__input__";
const STORAGE_KEY = "jupyter-clone:notebook:v1";

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function relativeTime(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 45) return "a few seconds ago";
  const m = Math.round(s / 60);
  if (m < 2) return "a minute ago";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 2) return "an hour ago";
  if (h < 24) return `${h} hours ago`;
  const d = Math.round(h / 24);
  return d < 2 ? "a day ago" : `${d} days ago`;
}

function formatCount(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

/** Group notebook cells into prompt → notebook turns for LLM context. */
function buildHistory(cells: UICell[]): HistoryTurn[] {
  const byTurn = new Map<number, HistoryTurn>();
  for (const c of cells) {
    let turn = byTurn.get(c.turn);
    if (!turn) {
      turn = { prompt: "", cells: [] };
      byTurn.set(c.turn, turn);
    }
    if (c.kind === "prompt") turn.prompt = c.source;
    else turn.cells.push({ cell_type: c.kind, source: c.source });
  }
  return [...byTurn.values()].filter((t) => t.cells.length > 0);
}

function turnCells(cells: UICell[], turn: number): NotebookCell[] {
  return cells
    .filter((c): c is GeneratedCell => c.kind !== "prompt" && c.turn === turn)
    .map((c) => ({ cell_type: c.kind, source: c.source }));
}

function ToolbarButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: IconName;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="jp-ToolbarButton"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function CellShell({
  active,
  onSelect,
  prompt,
  toolbar,
  output,
  className = "",
  children,
  cellRef,
}: {
  active: boolean;
  onSelect: () => void;
  prompt: ReactNode;
  toolbar?: ReactNode;
  output?: ReactNode;
  className?: string;
  children: ReactNode;
  cellRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={cellRef}
      className={`jp-Cell ${className}${active ? " jp-mod-active" : ""}`}
      onMouseDown={onSelect}
      onFocusCapture={onSelect}
    >
      <div className="jp-Cell-bar" />
      {toolbar && <div className="jp-cell-toolbar">{toolbar}</div>}
      <div className="jp-InputArea">
        <div className="jp-InputPrompt">{prompt}</div>
        {children}
      </div>
      {output}
    </div>
  );
}

export default function Notebook() {
  const [title, setTitle] = useState("Untitled");
  const [editingTitle, setEditingTitle] = useState(false);
  const [cells, setCells] = useState<UICell[]>([]);
  const [draft, setDraft] = useState("");
  // The prompt text is masked unless the eye button or Ctrl+E is held down.
  const [revealDraft, setRevealDraft] = useState(false);
  const [revealByKey, setRevealByKey] = useState(false);
  const [execCount, setExecCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(INPUT_ID);
  const [savedAt, setSavedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inputViewRef = useRef<EditorView | null>(null);
  const inputCellRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<NotebookCell | null>(null);

  // Restore from localStorage after mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.cells)) setCells(s.cells);
        if (typeof s.execCount === "number") setExecCount(s.execCount);
        if (typeof s.title === "string" && s.title) setTitle(s.title);
        if (typeof s.draft === "string") setDraft(s.draft);
        if (typeof s.savedAt === "number") setSavedAt(s.savedAt);
      }
    } catch {
      // Storage unavailable or corrupt: start fresh.
    }
    setHydrated(true);
  }, []);

  // Autosave (debounced).
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const ts = Date.now();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cells, execCount, title, draft, savedAt: ts }));
      } catch {
        // Ignore quota / privacy-mode errors.
      }
      setSavedAt(ts);
    }, 800);
    return () => clearTimeout(timer);
  }, [cells, execCount, title, draft, hydrated]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setSavedAt(Date.now());
        setNow(Date.now());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hold Ctrl+E to show the masked prompt; releasing either key hides it again.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        e.stopPropagation();
        setRevealByKey(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key.toLowerCase() === "e") setRevealByKey(false);
    };
    const hide = () => setRevealByKey(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const lastTurn = useMemo(() => cells.reduce((m, c) => Math.max(m, c.turn), 0), [cells]);
  const activeCell = cells.find((c) => c.id === activeId);

  function focusInput() {
    setActiveId(INPUT_ID);
    requestAnimationFrame(() => {
      inputCellRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      inputViewRef.current?.focus();
    });
  }

  async function run() {
    const prompt = draft.trim();
    if (running || !prompt) return;
    setError(null);
    setRunning(true);
    setReceived(0);
    setActiveId(INPUT_ID);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history: buildHistory(cells) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setReceived(text.length);
      }
      text += decoder.decode();

      const errAt = text.indexOf(STREAM_ERROR_MARKER);
      if (errAt !== -1) throw new Error(text.slice(errAt + STREAM_ERROR_MARKER.length));

      const generated = parseCells(text);
      if (generated.length === 0) {
        const snippet = text.trim().slice(0, 400);
        throw new Error(`The model response could not be parsed into notebook cells.${snippet ? `\n\n${snippet}` : ""}`);
      }

      const turn = lastTurn + 1;
      const n = execCount + 1;
      setCells((prev) => [
        ...prev,
        { id: uid(), kind: "prompt", source: draft, execCount: n, turn },
        ...generated.map((c): GeneratedCell => ({ id: uid(), kind: c.cell_type, source: c.source, turn })),
      ]);
      setExecCount(n);
      setDraft("");
      focusInput();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("KeyboardInterrupt: generation was interrupted by the user.");
      } else {
        setError(`${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  function interrupt() {
    abortRef.current?.abort();
  }

  function clearNotebook() {
    interrupt();
    setCells([]);
    setExecCount(0);
    setError(null);
    focusInput();
  }

  function newNotebook() {
    clearNotebook();
    setDraft("");
    setTitle("Untitled");
  }

  function updateCell(id: string, source: string) {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, source } : c)));
  }

  function deleteCell(id: string) {
    setCells((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      if (i === -1) return prev;
      const next = prev.filter((c) => c.id !== id);
      setActiveId(next[i]?.id ?? next[i - 1]?.id ?? INPUT_ID);
      return next;
    });
  }

  function copyCell(id: string) {
    const c = cells.find((x) => x.id === id);
    if (!c) return;
    clipboardRef.current = { cell_type: c.kind === "markdown" ? "markdown" : "code", source: c.source };
    navigator.clipboard?.writeText(c.source).catch(() => {});
  }

  function copyActive() {
    if (activeId === INPUT_ID) {
      clipboardRef.current = { cell_type: "code", source: draft };
      navigator.clipboard?.writeText(draft).catch(() => {});
    } else copyCell(activeId);
  }

  function cutActive() {
    copyActive();
    if (activeId === INPUT_ID) {
      if (!running) setDraft("");
    } else deleteCell(activeId);
  }

  function pasteBelow() {
    const clip = clipboardRef.current;
    if (!clip) return;
    if (activeId === INPUT_ID || !activeCell) {
      if (!running) setDraft((d) => (d ? `${d}\n${clip.source}` : clip.source));
      return;
    }
    const cell: GeneratedCell = { id: uid(), kind: clip.cell_type, source: clip.source, turn: activeCell.turn };
    setCells((prev) => {
      const i = prev.findIndex((c) => c.id === activeId);
      return [...prev.slice(0, i + 1), cell, ...prev.slice(i + 1)];
    });
    setActiveId(cell.id);
  }

  function downloadTurn(turn: number, count: number | null) {
    const nbCells = turnCells(cells, turn);
    if (nbCells.length === 0) return;
    const suffix = count ? `-output-${count}` : `-output`;
    downloadIpynb(nbCells, `${safeFilename(title)}${suffix}.ipynb`);
  }

  function downloadLatest() {
    const latest = [...cells].reverse().find((c) => c.kind !== "prompt");
    if (!latest) return;
    downloadIpynb(turnCells(cells, latest.turn), `${safeFilename(title)}.ipynb`);
  }

  const execCountForTurn = (turn: number): number | null => {
    const p = cells.find((c) => c.kind === "prompt" && c.turn === turn);
    return p?.kind === "prompt" ? p.execCount : null;
  };

  const hasOutput = cells.some((c) => c.kind !== "prompt");
  const canRun = !running && draft.trim().length > 0;

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New Notebook", action: newNotebook },
        { type: "separator" },
        { label: "Save Notebook", shortcut: "Ctrl+S", action: () => setSavedAt(Date.now()) },
        { label: "Rename Notebook…", action: () => setEditingTitle(true) },
        { type: "separator" },
        { label: "Download Latest Output (.ipynb)", action: hasOutput ? downloadLatest : undefined },
        {
          label: "Download Selected Output (.ipynb)",
          action:
            activeCell && turnCells(cells, activeCell.turn).length
              ? () => downloadTurn(activeCell.turn, execCountForTurn(activeCell.turn))
              : undefined,
        },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Cut Cell", shortcut: "X", action: cutActive },
        { label: "Copy Cell", shortcut: "C", action: copyActive },
        { label: "Paste Cell Below", shortcut: "V", action: pasteBelow },
        { type: "separator" },
        { label: "Delete Cell", shortcut: "D, D", action: activeId !== INPUT_ID ? () => deleteCell(activeId) : undefined },
        { label: "Clear Notebook", action: clearNotebook },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Show Line Numbers", disabled: true },
        { label: "Collapse All Code", disabled: true },
        { label: "Presentation Mode", disabled: true },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Run Selected Cell", shortcut: "Shift+Enter", action: canRun ? run : undefined },
        { label: "Run All Cells", disabled: true },
      ],
    },
    {
      label: "Kernel",
      items: [
        { label: "Interrupt Kernel", shortcut: "I, I", action: running ? interrupt : undefined },
        { label: "Restart Kernel and Clear Notebook", action: clearNotebook },
        { type: "separator" },
        { label: "Change Kernel…", disabled: true },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "Theme: JupyterLab Light", disabled: true },
        { label: "Autosave Documents", disabled: true },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Type a request in the input cell and press Shift+Enter.", disabled: true },
        { label: "Each run returns a complete, updated notebook.", disabled: true },
      ],
    },
  ];

  function cellToolbar(c: UICell) {
    const count = c.kind === "prompt" ? c.execCount : execCountForTurn(c.turn);
    const canDownload = turnCells(cells, c.turn).length > 0;
    return (
      <>
        {canDownload && (
          <ToolbarButton
            icon="download"
            title="Download this output as a notebook (.ipynb)"
            onClick={() => downloadTurn(c.turn, count)}
          />
        )}
        <ToolbarButton icon="copy" title="Copy cell source" onClick={() => copyCell(c.id)} />
        <ToolbarButton icon="delete" title="Delete this cell" onClick={() => deleteCell(c.id)} />
      </>
    );
  }

  const selectType = activeCell?.kind === "markdown" ? "markdown" : "code";

  return (
    <div className="jp-App">
      <header className="jp-TopPanel">
        <div className="jp-TopBar">
          <a className="jp-TopBar-logo" href="#" onClick={(e) => e.preventDefault()} title="Jupyter">
            <JupyterLogo />
          </a>
          <div className="jp-NotebookTitle">
            {editingTitle ? (
              <input
                autoFocus
                className="jp-NotebookTitle-input"
                defaultValue={title}
                onBlur={(e) => {
                  setTitle(e.target.value.trim() || "Untitled");
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
              />
            ) : (
              <button type="button" className="jp-NotebookTitle-text" title="Rename notebook" onClick={() => setEditingTitle(true)}>
                {title}
              </button>
            )}
          </div>
          <span className="jp-NotebookCheckpoint">Last Checkpoint: {relativeTime(savedAt, now)}</span>
        </div>
        <MenuBar menus={menus} />
      </header>

      <div className="jp-NotebookPanel">
        <div className="jp-Toolbar" role="toolbar">
          <ToolbarButton icon="save" title="Save and create checkpoint (Ctrl+S)" onClick={() => setSavedAt(Date.now())} />
          <ToolbarButton icon="add" title="Insert a cell below (B)" onClick={focusInput} />
          <ToolbarButton icon="cut" title="Cut this cell (X)" onClick={cutActive} />
          <ToolbarButton icon="copy" title="Copy this cell (C)" onClick={copyActive} />
          <ToolbarButton icon="paste" title="Paste this cell from the clipboard (V)" onClick={pasteBelow} />
          <ToolbarButton icon="run" title="Run this cell and advance (Shift+Enter)" onClick={run} disabled={!canRun} />
          <ToolbarButton icon="stop" title="Interrupt the kernel" onClick={interrupt} disabled={!running} />
          <ToolbarButton icon="refresh" title="Restart the kernel" onClick={clearNotebook} />
          <ToolbarButton icon="fastForward" title="Restart the kernel and run all cells" onClick={clearNotebook} />
          <div className="jp-Toolbar-select">
            <select value={selectType} onChange={() => {}} aria-label="Cell type">
              <option value="code">Code</option>
              <option value="markdown">Markdown</option>
              <option value="raw">Raw</option>
            </select>
            <Icon name="caretDown" size={18} className="jp-Toolbar-selectCaret" />
          </div>
          <div className="jp-Toolbar-spacer" />
          {running && <span className="jp-Toolbar-status">Generating… {formatCount(received)} chars</span>}
          <button type="button" className="jp-ToolbarButton jp-Toolbar-text" title="Open in JupyterLab" onMouseDown={(e) => e.preventDefault()}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#F37726" d="M12 3C7 3 3.3 5.2 2 8.3 4.2 6.2 7.9 5 12 5s7.8 1.2 10 3.3C20.7 5.2 17 3 12 3zm0 16c-4.1 0-7.8-1.2-10-3.3C3.3 18.8 7 21 12 21s8.7-2.2 10-5.3c-2.2 2.1-5.9 3.3-10 3.3z" />
            </svg>
            <span>JupyterLab</span>
          </button>
          <ToolbarButton icon="bug" title="Enable debugger" disabled />
          <button type="button" className="jp-ToolbarButton jp-Toolbar-text jp-KernelName" title="Switch kernel">
            Python 3 (ipykernel)
          </button>
          <div
            className={`jp-KernelStatus${running ? " jp-mod-busy" : ""}`}
            title={running ? "Kernel status: Busy" : "Kernel status: Idle"}
            aria-label={running ? "Kernel busy" : "Kernel idle"}
          />
        </div>

        <div className="jp-NotebookScroll">
          <div className="jp-Notebook">
            {cells.map((c) => {
              const active = c.id === activeId;
              if (c.kind === "markdown") {
                return (
                  <CellShell
                    key={c.id}
                    className="jp-MarkdownCell"
                    active={active}
                    onSelect={() => setActiveId(c.id)}
                    prompt=""
                    toolbar={cellToolbar(c)}
                  >
                    <div className="jp-RenderedMarkdown">{c.source}</div>
                  </CellShell>
                );
              }
              const isPrompt = c.kind === "prompt";
              return (
                <CellShell
                  key={c.id}
                  className={isPrompt ? "jp-CodeCell jp-PromptCell" : "jp-CodeCell"}
                  active={active}
                  onSelect={() => setActiveId(c.id)}
                  prompt={isPrompt ? `[${c.execCount}]:` : "[ ]:"}
                  toolbar={cellToolbar(c)}
                >
                  <div className="jp-InputArea-editor">
                    <CellEditor
                      value={c.source}
                      language={isPrompt ? "text" : "python"}
                      readOnly={isPrompt}
                      onChange={isPrompt ? undefined : (v) => updateCell(c.id, v)}
                      onRun={focusInput}
                    />
                  </div>
                </CellShell>
              );
            })}

            <CellShell
              cellRef={inputCellRef}
              className="jp-CodeCell jp-InputCell"
              active={activeId === INPUT_ID}
              onSelect={() => setActiveId(INPUT_ID)}
              prompt={running ? "[*]:" : "[ ]:"}
              output={
                error ? (
                  <div className="jp-OutputArea">
                    <div className="jp-OutputPrompt" />
                    <pre className="jp-RenderedText jp-mod-stderr">{error}</pre>
                  </div>
                ) : null
              }
            >
              <div className={`jp-InputArea-editor jp-InputArea-masked${revealDraft || revealByKey ? "" : " jp-mod-masked"}`}>
                <button
                  type="button"
                  className="jp-RevealButton"
                  title="Hold to show the prompt"
                  aria-label="Hold to show the prompt"
                  aria-pressed={revealDraft}
                  onPointerDown={(e) => {
                    // Keep focus (and the caret) in the editor while revealing.
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setRevealDraft(true);
                  }}
                  onPointerUp={() => setRevealDraft(false)}
                  onPointerCancel={() => setRevealDraft(false)}
                  onLostPointerCapture={() => setRevealDraft(false)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") setRevealDraft(true);
                  }}
                  onKeyUp={() => setRevealDraft(false)}
                  onBlur={() => setRevealDraft(false)}
                >
                  <Icon name="visibility" />
                </button>
                <CellEditor
                  markSelection
                  value={draft}
                  onChange={setDraft}
                  readOnly={running}
                  placeholder={
                    cells.length
                      ? "Describe changes to the notebook above… (Shift+Enter to run)"
                      : "Describe the Python code you want… (Shift+Enter to run)"
                  }
                  onRun={run}
                  onCreate={(view) => {
                    inputViewRef.current = view;
                  }}
                />
              </div>
            </CellShell>
          </div>
        </div>
      </div>
    </div>
  );
}
