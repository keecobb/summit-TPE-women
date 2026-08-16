import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { GameDetail, GameBoxScoreRow } from "@/lib/types";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static -- this page has no
// searchParams usage at all, making it one of the routes most likely to
// occasionally serve a stale cached snapshot under Next's default
// `dynamic: "auto"` behavior. See ARCHITECTURE_HOSTING_PLAN.md's
// caching-fix notes for the full writeup.
export const dynamic = "force-dynamic";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ sport: string; id: string }>;
}) {
  const { sport, id } = await params;

  let game: GameDetail;
  try {
    game = await apiFetch<GameDetail>(`/${sport}/games/${id}`, { revalidate: 60 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const homeWon = game.winner_team_id === game.home_team_id;
  const awayWon = game.winner_team_id === game.away_team_id;

  return (
    <div>
      <h1>
        {game.away_team_name} @ {game.home_team_name}
      </h1>
      <p className="subtitle">
        {formatGameDate(game.date)} &middot; {game.season}
        {game.neutral_site ? " · Neutral site" : ""}
        {game.overtime ? " · OT" : ""}
        {game.conference_game ? " · Conference game" : ""}
      </p>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 20, maxWidth: "68ch" }}>
        Full box scores for both teams, most-productive scorer first -- click any player to jump to their profile.
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="stat-grid" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
          <div className="stat-tile">
            <div className="value" style={awayWon ? { color: "var(--accent)" } : undefined}>
              {game.away_score ?? "--"}
            </div>
            <div className="label">
              <Link href={`/${sport}/teams/${game.away_team_id}`}>{game.away_team_name}</Link>
              {awayWon && <span className="pill pill-good" style={{ marginLeft: 6 }}>W</span>}
            </div>
          </div>
          <div className="stat-tile">
            <div className="value" style={{ fontSize: "1.1rem", color: "var(--text-dim)" }}>
              final
            </div>
          </div>
          <div className="stat-tile">
            <div className="value" style={homeWon ? { color: "var(--accent)" } : undefined}>
              {game.home_score ?? "--"}
            </div>
            <div className="label">
              <Link href={`/${sport}/teams/${game.home_team_id}`}>{game.home_team_name}</Link>
              {homeWon && <span className="pill pill-good" style={{ marginLeft: 6 }}>W</span>}
            </div>
          </div>
        </div>
      </div>

      <BoxScoreCard title={`${game.away_team_name} box score`} rows={game.away_box_score} sport={sport} />
      <BoxScoreCard title={`${game.home_team_name} box score`} rows={game.home_box_score} sport={sport} />
    </div>
  );
}

function BoxScoreCard({ title, rows, sport }: { title: string; rows: GameBoxScoreRow[]; sport: string }) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <h2>{title}</h2>
        <p className="empty-state">No box score on record for this team in this game.</p>
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Min</th>
              <th>Pts</th>
              <th>Reb</th>
              <th>Ast</th>
              <th>Stl</th>
              <th>Blk</th>
              <th>TO</th>
              <th>FG</th>
              <th>3PT</th>
              <th>FT</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.player_id}>
                <td>
                  <Link href={`/${sport}/players/${r.player_id}`}>{r.name}</Link>
                  {r.started ? <span className="pill" style={{ marginLeft: 6 }}>Started</span> : null}
                </td>
                <td>{r.minutes}</td>
                <td>{r.points}</td>
                <td>{r.rebounds}</td>
                <td>{r.assists}</td>
                <td>{r.steals}</td>
                <td>{r.blocks}</td>
                <td>{r.turnovers}</td>
                <td>{r.fgm}-{r.fga}</td>
                <td>{r.tfgm}-{r.tfga}</td>
                <td>{r.ftm}-{r.fta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
