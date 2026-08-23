"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Picked {
  id: number;
  label: string;
}

/**
 * Client-side picker for the batch scouting board: one target team plus a
 * shortlist of candidate players, built up entirely in local state (no
 * page navigation until "Run batch projection" is pressed) since the
 * underlying /project/batch call needs a JSON body, not query params --
 * see lib/api.ts's apiFetch POST support and app/[sport]/tpe/batch/page.tsx.
 */
export default function BatchBuilder({ sport }: { sport: string }) {
  const router = useRouter();
  const [team, setTeam] = useState<Picked | null>(null);
  const [players, setPlayers] = useState<Picked[]>([]);
  const [addKey, setAddKey] = useState(0); // remounts the "add player" Typeahead after each pick

  function addPlayer(p: Picked) {
    setPlayers((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setAddKey((k) => k + 1);
  }

  function removePlayer(id: number) {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  function runBatch() {
    if (!team || players.length === 0) return;
    const params = new URLSearchParams();
    params.set("team_id", String(team.id));
    for (const p of players) params.append("player_id", String(p.id));
    router.push(`/${sport}/tpe/batch?${params.toString()}`);
  }

  return (
    <div className="card card-prose" style={{ maxWidth: 520 }}>
      <div className="field">
        <label htmlFor="batch-team-search">Target team (the roster spot you&apos;re filling)</label>
        <TeamPicker sport={sport} onPick={setTeam} picked={team} />
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="batch-player-search">Add candidates ({players.length} on the board)</label>
        <PlayerAdder key={addKey} sport={sport} onPick={addPlayer} />
      </div>

      {players.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {players.map((p) => (
            <span key={p.id} className="pill">
              {p.label}{" "}
              <button
                type="button"
                onClick={() => removePlayer(p.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", marginLeft: 4 }}
                aria-label={`Remove ${p.label}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        className="btn btn-primary"
        type="button"
        onClick={runBatch}
        disabled={!team || players.length === 0}
        style={{ marginTop: 16 }}
      >
        Run batch projection
      </button>
      {(!team || players.length === 0) && (
        <p className="section-note" style={{ marginTop: 8 }}>
          Pick a target team and at least one candidate to run it.
        </p>
      )}
    </div>
  );
}

// Thin wrappers around Typeahead's "select" mode that hand the picked
// {id, label} straight back to BatchBuilder's state instead of filling a
// hidden form field -- this page has no <form> submit, it navigates
// programmatically once the whole shortlist is built.
function TeamPicker({ sport, onPick, picked }: { sport: string; onPick: (p: Picked | null) => void; picked: Picked | null }) {
  if (picked) {
    return (
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
        <span style={{ fontWeight: 600 }}>{picked.label}</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: "0.85rem" }}
        >
          Change ✕
        </button>
      </div>
    );
  }
  return (
    <SearchOnly
      sport={sport}
      kind="teams"
      inputId="batch-team-search"
      placeholder="e.g. Baylor"
      onPick={onPick}
    />
  );
}

function PlayerAdder({ sport, onPick }: { sport: string; onPick: (p: Picked) => void }) {
  return (
    <SearchOnly
      sport={sport}
      kind="players"
      inputId="batch-player-search"
      placeholder="Search a player to add..."
      onPick={onPick}
    />
  );
}

// Typeahead's "select" mode is built around a <form>'s hidden field, which
// this page doesn't have -- SearchOnly reimplements just the query/results/
// pick interaction against the same /api/search proxy, but calls back
// directly instead of writing a hidden input.
function SearchOnly({
  sport,
  kind,
  inputId,
  placeholder,
  onPick,
}: {
  sport: string;
  kind: "players" | "teams";
  inputId: string;
  placeholder: string;
  onPick: (p: Picked) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; label: string; sub: string }[]>([]);
  const [open, setOpen] = useState(false);

  async function onChange(v: string) {
    setQuery(v);
    if (v.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    try {
      const res = await fetch(`/api/search?sport=${sport}&kind=${kind}&q=${encodeURIComponent(v.trim())}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setOpen(true);
    } catch {
      setResults([]);
    }
  }

  return (
    <div className="typeahead" style={{ position: "relative" }}>
      <input
        id={inputId}
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
        style={{ width: "100%" }}
      />
      {open && results.length > 0 && (
        <div className="typeahead-results">
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              className="typeahead-option"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick({ id: r.id, label: r.label });
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
            >
              {r.label}
              <div className="sub">{r.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
