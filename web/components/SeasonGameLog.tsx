"use client";

import { useState } from "react";
import type { PlayerGameLogRow } from "@/lib/types";

/**
 * Click-to-expand per-game log for one season, nested inside the season-by-
 * season trajectory table on a player's profile. Fetches lazily (only when
 * expanded) from the same-origin /api/game-logs proxy -- see that route for
 * why (keeps the real API key server-side).
 */
export default function SeasonGameLog({ playerId, season }: { playerId: number; season: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [games, setGames] = useState<PlayerGameLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && games === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/game-logs?player_id=${playerId}&season=${encodeURIComponent(season)}`);
        const data = await res.json();
        if (data.error) setError(data.error);
        else setGames(data.games ?? []);
      } catch {
        setError("Couldn't load game logs.");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <tr>
      <td colSpan={9} style={{ padding: 0, borderBottom: open ? undefined : "none" }}>
        <button
          type="button"
          onClick={toggle}
          style={{
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            fontSize: "0.78rem",
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          {open ? "▾" : "▸"} {open ? "Hide" : "Show"} game log for {season}
        </button>
        {open && (
          <div style={{ padding: "0 12px 12px" }}>
            {loading && <p className="section-note" style={{ margin: 0 }}>Loading...</p>}
            {error && <p className="section-note" style={{ margin: 0, color: "var(--gold-dim)" }}>{error}</p>}
            {games && games.length === 0 && (
              <p className="section-note" style={{ margin: 0 }}>No individual game rows on record for this season.</p>
            )}
            {games && games.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Opponent</th>
                      <th>Min</th>
                      <th>Pts</th>
                      <th>Reb</th>
                      <th>Ast</th>
                      <th>Stl</th>
                      <th>Blk</th>
                      <th>TO</th>
                      <th>FG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((g, i) => (
                      <tr key={i}>
                        <td>{formatDate(g.date)}</td>
                        <td>
                          {g.opponent_name ?? "--"}
                          {g.opponent_tier && (
                            <span className="pill" style={{ marginLeft: 6 }}>
                              {g.opponent_tier}
                            </span>
                          )}
                        </td>
                        <td>{g.minutes?.toFixed(0)}</td>
                        <td>{g.points}</td>
                        <td>{g.rebounds}</td>
                        <td>{g.assists}</td>
                        <td>{g.steals}</td>
                        <td>{g.blocks}</td>
                        <td>{g.turnovers}</td>
                        <td>
                          {g.fgm}-{g.fga}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}
