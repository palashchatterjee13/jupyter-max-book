"use client";

import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { type: "separator" }
  | { label: string; shortcut?: string; disabled?: boolean; action?: () => void };

export interface Menu {
  label: string;
  items: MenuItem[];
}

export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpenIndex] = useState<number | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // The bar scrolls horizontally on narrow screens, so menus are fixed-positioned under their button.
  const setOpen = (i: number | null) => {
    const rect = i === null ? null : buttons.current[i]?.getBoundingClientRect();
    if (rect) setPos({ left: rect.left, top: rect.bottom });
    setOpenIndex(i);
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="jp-MenuBar" ref={ref} role="menubar">
      {menus.map((menu, i) => (
        <div key={menu.label} className="jp-MenuBar-itemWrap">
          <button
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="menuitem"
            className={`jp-MenuBar-item${open === i ? " jp-mod-active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(open === i ? null : i);
            }}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <ul className="jp-Menu" role="menu" style={{ left: pos.left, top: pos.top - 1 }}>
              {menu.items.map((item, j) =>
                "type" in item ? (
                  <li key={j} className="jp-Menu-separator" role="separator" />
                ) : (
                  <li
                    key={j}
                    role="menuitem"
                    aria-disabled={item.disabled || !item.action}
                    className={`jp-Menu-item${item.disabled || !item.action ? " jp-mod-disabled" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (item.disabled || !item.action) return;
                      setOpen(null);
                      item.action();
                    }}
                  >
                    <span className="jp-Menu-itemLabel">{item.label}</span>
                    {item.shortcut && <span className="jp-Menu-itemShortcut">{item.shortcut}</span>}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
