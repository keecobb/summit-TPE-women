"use client";

import { useState } from "react";
import type { PlayerDetail } from "@/lib/types";

type Mode = "pergame" | "per40";

// Counting-stat rows swap between per-game and per-40-minute rates via the
// toggle below. Shooting percentages (TS%/FG%/3FG%/FT%) don't have a
// meaningful "per-40" version -- a percentage is already rate-invariant --
// so they're shown once, unaffected by the toggle, alongside GP/GS/MPG/
// Summit Score (also not counting-stat rates).
const PERGAME_ROWS: { label: string; key: keyof PlayerDetail }[] = [
  { label: "PPG", key: "ppg" },
  { label: "RPG", key: "rpg" },
  { label: "APG", key: "apg" },
  { label: "SPG", key: "spg" },
  { label: "BPG", key: "bpg" },
  { label: "TOPG", key: "topg" },
];

const PER40_ROWS: { label: string; key: keyof PlayerDetail }[] = [
  { label: "Pts/40", key: "per40_pts" },
  { label: "Reb/40", key: "per40_reb" },
  { label: "Ast/40", key: "per40_ast" },
  { label: "Stl/40", key: "per40_stl" },
  { label: "Blk/40", key: "per40_blk" },
  { label: "TO/40", key: "per40_tov" },
];

export default function PerGameProductionCard({ player }: { player: PlayerDetail }) {
  const [mode, setMode] = useState<Mode>("pergame");
  const rows = mode === "pergame" ? PERGAME_ROWS : PER40_ROWS;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Per-Game Production</h2>
        <div className="toggle-group" role="group" aria-label="Show per-game averages or per-40-minute rates">
          <button
            type="button"
            className={`toggle-btn${mode === "pergame" ? " active" : ""}`}
            onClick={() => setMode("pergame")}
            aria-pressed={mode === "pergame"}
          >
            Per Game
          </button>
          <button
            type="button"
            className={`toggle-btn${mode === "per40" ? " active" : ""}`}
            onClick={() => setMode("per40")}
            aria-pressed={mode === "per40"}
          >
            Per 40
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="GP" value={player.games} decimals={0} />
        <Stat label="GS" value={player.games_started} decimals={0} />
        <Stat label="MPG" value={player.avg_minutes} />
        {rows.map((r) => (
          <Stat key={r.key} label={r.label} value={player[r.key] as number | null | undefined} />
        ))}
      </div>

      <div className="stat-grid">
        {/* null * 100 === 0 in JS -- guard explicitly so a player with too
            few shot attempts to compute a shooting % (see build_cache.py's
            15-attempt floor, and the >=1-attempt floor for 3FG%/FT%) shows
            "--" instead of a misleading "0.0". */}
        <Stat label="TS%" value={player.ts_pct != null ? player.ts_pct * 100 : null} />
        <Stat label="FG%" value={player.fg_pct != null ? player.fg_pct * 100 : null} />
        <Stat label="3FG%" value={player.tfg_pct != null ? player.tfg_pct * 100 : null} />
        <Stat label="FT%" value={player.ft_pct != null ? player.ft_pct * 100 : null} />
        <Stat label="Summit Score" value={player.hoop_score} highlight />
      </div>

      {player.national_percentile != null && (
        <p className="section-note">
          <strong>Top {player.national_percentile}%</strong> nationally by Summit Score, among{" "}
          {player.season} Division I players on record.
        </p>
      )}
      {player.in_transfer_portal != null && (
        <p className="section-note">
          Transfer portal status: <strong>{player.in_transfer_portal ? "In the portal" : "Not in the portal"}</strong>
        </p>
      )}
    </div>
  );
}

function Stat({
  label, value, highlight, decimals = 1,
}: {
  label: string;
  value: unknown;
  highlight?: boolean;
  decimals?: number;
}) {
  const num = typeof value === "number" ? value.toFixed(decimals) : String(value ?? "--");
  return (
    <div className="stat-tile">
      <div className="value" style={highlight ? { color: "var(--accent)" } : undefined}>
        {num}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
