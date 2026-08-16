"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Result {
  id: number;
  label: string;
  sub: string;
}

/**
 * Type-to-search dropdown for players/teams, backed by the same-origin
 * /api/search proxy (never calls the real API directly -- the API key
 * stays server-side, see app/api/search/route.ts).
 *
 * Two modes:
 *  - "navigate" (default): picking a result routes straight to buildHref(id).
 *    Used where the field is the whole interaction (player search, browse a
 *    team, pick a team in Team Fits).
 *  - "select": picking a result fills a hidden <input name={hiddenName}>
 *    with the id and shows the choice as a locked chip, for use inside a
 *    larger form that has other fields to fill before submitting (e.g. the
 *    TPE target-school field, submitted together with role/minutes).
 */
export default function Typeahead({
  sport,
  kind,
  placeholder,
  hrefTemplate,
  mode = "navigate",
  hiddenName,
  inputId,
  required,
  defaultValue,
  defaultSelectedId,
  defaultSelectedLabel,
}: {
  sport: string;
  kind: "players" | "teams";
  placeholder: string;
  /** For mode="navigate": a path containing the literal token "{id}", e.g.
   *  "/tpe?player_id={id}". Passed as a plain string (not a function) since
   *  Server Components can't pass functions to Client Components. */
  hrefTemplate?: string;
  mode?: "navigate" | "select";
  hiddenName?: string;
  inputId?: string;
  required?: boolean;
  defaultValue?: string;
  defaultSelectedId?: number;
  defaultSelectedLabel?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue ?? "");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [selected, setSelected] = useState<{ id: number; label: string } | null>(
    defaultSelectedId && defaultSelectedLabel ? { id: defaultSelectedId, label: defaultSelectedLabel } : null
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?sport=${sport}&kind=${kind}&q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen(true);
        setHighlighted(-1);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, kind, sport]);

  function select(r: Result) {
    setOpen(false);
    if (mode === "navigate" && hrefTemplate) {
      router.push(hrefTemplate.replace("{id}", String(r.id)));
    } else {
      setSelected({ id: r.id, label: r.label });
      setQuery("");
    }
  }

  function clearSelection() {
    setSelected(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      select(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (mode === "select" && selected) {
    return (
      <div className="typeahead">
        {hiddenName && <input type="hidden" name={hiddenName} value={selected.id} required={required} />}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            background: "var(--bg-panel-2)",
          }}
        >
          <span style={{ fontWeight: 600 }}>{selected.label}</span>
          <button
            type="button"
            onClick={clearSelection}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: "0.85rem" }}
          >
            Change ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="typeahead" ref={containerRef}>
      {mode === "select" && hiddenName && required && !selected && (
        // Empty-but-required shadow field so native form validation blocks
        // submit until a real selection is made (the visible text input
        // isn't itself the value being submitted in "select" mode).
        <input type="text" required style={{ position: "absolute", opacity: 0, height: 0, width: 0, padding: 0, border: 0 }} value="" onChange={() => {}} tabIndex={-1} aria-hidden />
      )}
      <input
        id={inputId}
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        style={{ width: "100%" }}
      />
      {open && results.length > 0 && (
        <div className="typeahead-results">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.id}
              className={`typeahead-option${i === highlighted ? " highlighted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                select(r);
              }}
            >
              {r.label}
              <div className="sub">{r.sub}</div>
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <div className="typeahead-results">
          <div className="typeahead-option" style={{ cursor: "default" }}>
            No matches
          </div>
        </div>
      )}
    </div>
  );
}
