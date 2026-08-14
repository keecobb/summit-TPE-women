import { Fragment } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type {
  PlayerDetail, PlayerTrajectory, PlayerTrajectorySeason, PlayerSplits, OpponentTierSplit,
  PlayerGameLogs, PlayerGameLogRow,
} from "@/lib/types";
import { TIERS, tierAbbrev } from "@/lib/types";
import SeasonGameLog from "@/components/SeasonGameLog";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static -- this page in
// particular has no searchParams usage at all (unlike most other pages
// here), so under Next's default `dynamic: "auto"` behavior it was the
// single most likely page on the site to occasionally serve a stale/
// out-of-sync cached snapshot until the next revalidation, matching the
// "sometimes some data doesn't show until I refresh" report. See
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup.
export const dynamic = "force-dynamic";

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const player = await apiFetch<PlayerDetail>(`/players/${id}`, { revalidate: 60 });

  let trajectory: PlayerTrajectory | null = null;
  try {
    trajectory = await apiFetch<PlayerTrajectory>(`/players/${id}/trajectory`, { revalidate: 60 });
  } catch (e) {
    // Trajectory 404s if the player has no multi-season history on record --
    // not an error worth showing, the current-season card below still renders.
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  let splits: PlayerSplits | null = null;
  try {
    splits = await apiFetch<PlayerSplits>(`/players/${id}/splits`, { revalidate: 60 });
  } catch (e) {
    // Same as trajectory above -- a thin_sample player with zero games this
    // season has nothing to split, not an error worth surfacing.
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  // Best 3 games this season by points + rebounds + assists -- a simple,
  // well-understood combined-production read, computed client-side from the
  // same real per-game rows /players/{id}/game-logs already exposes (no new
  // backend endpoint needed). Same "zero games -> nothing to show" case as
  // splits above, not an error. The full chronological list (oldest first)
  // is also kept for the Game-by-Game Production Rating chart below -- the
  // API returns most-recent-first, so it's reversed once here for both uses.
  let bestGames: (PlayerGameLogRow & { combined: number })[] = [];
  let gamesChronological: PlayerGameLogRow[] = [];
  try {
    const logs = await apiFetch<PlayerGameLogs>(`/players/${id}/game-logs`, { params: { season: player.season }, revalidate: 60 });
    bestGames = logs.games
      .map((g) => ({ ...g, combined: g.points + g.rebounds + g.assists }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 3);
    gamesChronological = [...logs.games].reverse();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  const transfers = trajectory ? countTransfers(trajectory) : 0;

  return (
    <div>
      <h1>{player.name}</h1>
      <p className="subtitle">
        {player.position}
        {player.height ? ` · ${player.height}` : ""} &middot; {player.class_year} &middot;{" "}
        {player.team_name ?? "--"} ({player.team_tier ?? player.tier}) &middot; {player.season}
        {player.thin_sample ? (
          <span className="pill pill-warn" style={{ marginLeft: 8 }}>limited sample</span>
        ) : null}
      </p>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 20, maxWidth: "68ch" }}>
        Real season production first, then how it splits against tougher/weaker opponents and how it&apos;s
        trended over time. Want to see what she&apos;d project to at a different school? Use the button below to
        send her straight into Transfer Projection.
      </p>

      {player.thin_sample ? (
        <div className="info-box">
          Limited {player.season} sample: {player.games} game{player.games === 1 ? "" : "s"}
          {player.total_minutes != null ? `, ${player.total_minutes} total minutes` : ""} on record this season
          -- below the usual floor for a full profile (5 games / 100 minutes). She&apos;s shown here because
          every rostered player should be findable, but treat the numbers below as a small, noisier sample
          rather than a full-season read.
        </div>
      ) : null}

      <div className="hero-actions" style={{ marginBottom: 24 }}>
        <Link className="btn btn-primary" href={`/tpe?player_id=${player.player_id}`}>
          Project this player to a school
        </Link>
      </div>

      <div className="card">
        <h2>Per-game production</h2>
        <div className="stat-grid">
          <Stat label="GP" value={player.games} decimals={0} />
          <Stat label="MPG" value={player.avg_minutes} />
          <Stat label="PPG" value={player.ppg} />
          <Stat label="RPG" value={player.rpg} />
          <Stat label="APG" value={player.apg} />
          <Stat label="SPG" value={player.spg} />
          <Stat label="BPG" value={player.bpg} />
          <Stat label="TOPG" value={player.topg} />
        </div>
      </div>

      <div className="card">
        <h2>Efficiency &amp; per-40</h2>
        <div className="stat-grid">
          {/* null * 100 === 0 in JS -- guard explicitly so a player with too
              few shot attempts to compute a shooting % (see build_cache.py's
              15-attempt floor) shows "--" instead of a misleading "0.0". */}
          <Stat label="TS%" value={player.ts_pct != null ? player.ts_pct * 100 : null} />
          <Stat label="FG%" value={player.fg_pct != null ? player.fg_pct * 100 : null} />
          <Stat label="Pts/40" value={player.per40_pts} />
          <Stat label="Reb/40" value={player.per40_reb} />
          <Stat label="Ast/40" value={player.per40_ast} />
          <Stat label="Blk/40" value={player.per40_blk} />
          <Stat label="Stl/40" value={player.per40_stl} />
          <Stat label="TO/40" value={player.per40_tov} />
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

      {bestGames.length > 0 && (
        <div className="card">
          <h2>Best 3 Games</h2>
          <p className="section-note">
            Ranked by points + rebounds + assists combined, {player.season} season -- real box scores, no
            projection involved.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Min</th>
                  <th>PTS</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>TO</th>
                  <th>FG</th>
                  <th>3PT</th>
                  <th>FT</th>
                </tr>
              </thead>
              <tbody>
                {bestGames.map((g) => (
                  <tr key={`${g.date}-${g.opponent_name}`}>
                    <td>{formatShortDate(g.date)}</td>
                    <td>
                      {g.opponent_name ?? "--"}
                      {g.opponent_tier ? (
                        <span className="pill" style={{ marginLeft: 6 }} title={g.opponent_tier}>
                          {tierAbbrev(g.opponent_tier)}
                        </span>
                      ) : null}
                    </td>
                    <td>{g.minutes}</td>
                    <td style={{ color: "var(--accent)", fontWeight: 700 }}>{g.points}</td>
                    <td>{g.rebounds}</td>
                    <td>{g.assists}</td>
                    <td>{g.steals}</td>
                    <td>{g.blocks}</td>
                    <td>{g.turnovers}</td>
                    <td>{g.fgm}-{g.fga}</td>
                    <td>{g.tfgm}-{g.tfga}</td>
                    <td>{g.ftm}-{g.fta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gamesChronological.length > 1 && (
        <div className="card">
          <h2>
            Game-by-Game Production Rating
            <span className="hint" title="Production Rating = Points + Rebounds + Assists + Steals + Blocks - Turnovers, computed for each individual game. It's a rough single-number stand-in for a full box score -- not a substitute for Summit Score (which also accounts for shooting efficiency, minutes, and opponent strength), but a quick, game-by-game gut check on total two-way contribution.">
              ?
            </span>
          </h2>
          <p className="section-note">
            {player.season} season, one bar per game -- points, rebounds, assists, steals, and blocks added up,
            turnovers subtracted, so a quiet scoring night that was still a big all-around game (or a big scoring
            night undone by turnovers) still shows up as a strong or weak game here. Bars that dip below the line
            are games with a negative production rating (more turnovers than total production).
          </p>
          <GameByGameChart
            games={gamesChronological}
            getValue={productionRating}
            color="var(--good)"
            label="Production rating by game this season"
            getTooltip={(g) =>
              `${formatShortDate(g.date)} vs ${g.opponent_name ?? "--"}: ${productionRating(g)} production rating ` +
              `(${g.points} pts, ${g.rebounds} reb, ${g.assists} ast, ${g.steals} stl, ${g.blocks} blk, ${g.turnovers} TO)`
            }
          />
        </div>
      )}

      {splits && splits.total_games > 0 && (
        <div className="card">
          <h2>
            Performance by Opponent Strength
            <span className="hint" title="Real per-game production, split by how strong the opponent was -- each tier of opponent, the nation's 50 highest-rated teams regardless of tier, and just her last 10 games. Not a projection.">
              ?
            </span>
          </h2>
          <p className="section-note">{splits.season} season, {splits.total_games} games logged.</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Split</th>
                  <th>GP</th>
                  <th>PPG</th>
                  <th>RPG</th>
                  <th>APG</th>
                  <th>SPG</th>
                  <th>BPG</th>
                  <th>TOPG</th>
                  <th>MPG</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <SplitRow key={t} label={`vs. ${t} (${tierAbbrev(t)})`} row={splits!.by_opponent_tier[t]} />
                ))}
                <SplitRow label="vs. Top 50 nationally" row={splits.vs_top50} />
                <SplitRow label="Last 10 games" row={splits.last10} />
              </tbody>
            </table>
          </div>
          <p className="section-note" style={{ marginTop: 10 }}>{splits.vs_top50_note}</p>
        </div>
      )}

      {trajectory && trajectory.seasons.length > 0 && (
        <div className="card">
          <h2>Season by season {transfers > 0 && <span className="pill pill-warn">{transfers} transfer{transfers > 1 ? "s" : ""} on record</span>}</h2>
          {trajectory.seasons.length > 1 && (
            <>
              <p className="section-note">
                Trend: <strong>{trajectory.trend}</strong> ({trajectory.avg_hoop_score_change_per_season > 0 ? "+" : ""}
                {trajectory.avg_hoop_score_change_per_season.toFixed(1)} Summit Score/season) &middot; {trajectory.trend_note}
              </p>
              <SeasonTrendChart seasons={trajectory.seasons} />
            </>
          )}
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th>
                <th>Team</th>
                <th>GP</th>
                <th>MPG</th>
                <th>PPG</th>
                <th>RPG</th>
                <th>APG</th>
                <th>TS%</th>
                <th>Summit Score</th>
              </tr>
            </thead>
            <tbody>
              {trajectory.seasons.map((s, i) => {
                const prevTeam = i > 0 ? trajectory!.seasons[i - 1].team_name : null;
                const isTransferSeason = prevTeam !== null && prevTeam !== s.team_name;
                return (
                  <Fragment key={s.season}>
                    <tr>
                      <td>{s.season}</td>
                      <td>
                        {s.team_name}
                        {isTransferSeason && <span className="pill pill-warn" style={{ marginLeft: 8 }}>transferred in</span>}
                      </td>
                      <td>{s.games}</td>
                      <td>{s.avg_minutes?.toFixed(1)}</td>
                      <td>{s.ppg?.toFixed(1)}</td>
                      <td>{s.rpg?.toFixed(1)}</td>
                      <td>{s.apg?.toFixed(1)}</td>
                      <td>{s.ts_pct?.toFixed(1)}</td>
                      <td>
                        {s.hoop_score?.toFixed(1)}
                        {s.thin_sample ? (
                          <span className="pill pill-warn" style={{ marginLeft: 6 }} title="Limited sample that season -- below the games/minutes floor for a full profile.">
                            limited
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    <SeasonGameLog playerId={player.player_id} season={s.season} />
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, decimals = 1 }: { label: string; value: unknown; highlight?: boolean; decimals?: number }) {
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

function SplitRow({ label, row }: { label: string; row: OpponentTierSplit | null }) {
  if (!row) {
    return (
      <tr>
        <td>{label}</td>
        <td colSpan={8} className="section-note">
          No games in this split
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{label}</td>
      <td>{row.games}</td>
      <td>{row.avg_points.toFixed(1)}</td>
      <td>{row.avg_rebounds.toFixed(1)}</td>
      <td>{row.avg_assists.toFixed(1)}</td>
      <td>{row.avg_steals.toFixed(1)}</td>
      <td>{row.avg_blocks.toFixed(1)}</td>
      <td>{row.avg_turnovers.toFixed(1)}</td>
      <td>{row.avg_minutes.toFixed(1)}</td>
    </tr>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function countTransfers(trajectory: PlayerTrajectory): number {
  let count = 0;
  for (let i = 1; i < trajectory.seasons.length; i++) {
    if (trajectory.seasons[i].team_name !== trajectory.seasons[i - 1].team_name) count++;
  }
  return count;
}

// Simple SVG line chart, Summit Score across every season on record (2-3
// points, typically) -- a single series, so no legend needed (the card
// heading + trend line above already name it). One accent-colored line with
// a rounded-end stroke, direct value labels on every point since there are
// only a handful, and a native <title> per point for a hover tooltip.
function SeasonTrendChart({ seasons }: { seasons: PlayerTrajectorySeason[] }) {
  const width = 560;
  const height = 130;
  const padX = 40;
  const padTop = 24;
  const padBottom = 24;
  const values = seasons.map((s) => s.hoop_score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const stepX = seasons.length > 1 ? (width - padX * 2) / (seasons.length - 1) : 0;
  const points = seasons.map((s, i) => {
    const x = padX + i * stepX;
    const y = height - padBottom - ((s.hoop_score - min) / range) * (height - padTop - padBottom);
    return { x, y, s };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <div style={{ marginBottom: 16 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Summit Score by season">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="var(--accent)" />
            <title>{`${p.s.season}: ${p.s.hoop_score.toFixed(1)} Summit Score (${p.s.team_name})`}</title>
            <text x={p.x} y={p.y - 10} fontSize={11} textAnchor="middle" fill="var(--text)">
              {p.s.hoop_score.toFixed(1)}
            </text>
            <text x={p.x} y={height - 6} fontSize={10} textAnchor="middle" fill="var(--text-dim)">
              {p.s.season}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// A single game's overall two-way production in one number: everything she
// contributed (points/rebounds/assists/steals/blocks) minus what she gave
// back (turnovers) -- a rougher, wider-range "how good was this game as a
// whole" read than points alone, closer to a box-score gestalt than a single
// counting stat.
function productionRating(g: PlayerGameLogRow): number {
  return g.points + g.rebounds + g.assists + g.steals + g.blocks - g.turnovers;
}

// Simple SVG bar chart, one magnitude series per game across a season in
// chronological order -- a single hue, horizontally scrollable since a full
// season can be 25-35+ games. A native <title> per bar gives the date/
// opponent/full box-score line on hover. Shared by the points chart and the
// production-rating chart below (same visual language, different accessor/
// color/tooltip).
function GameByGameChart({
  games, getValue, getTooltip, color, label,
}: {
  games: PlayerGameLogRow[];
  getValue: (g: PlayerGameLogRow) => number;
  getTooltip: (g: PlayerGameLogRow) => string;
  color: string;
  label: string;
}) {
  const perGame = 20;
  const width = Math.max(360, games.length * perGame);
  const height = 130;
  const padTop = 10;
  const padBottom = 20;
  const values = games.map(getValue);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - Math.min(min, 0), 1);
  const barWidth = Math.min(14, perGame - 5);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {min < 0 && (
          <line
            x1={0} x2={width}
            y1={height - padBottom - (Math.max(0, -min) / range) * (height - padTop - padBottom)}
            y2={height - padBottom - (Math.max(0, -min) / range) * (height - padTop - padBottom)}
            stroke="var(--border)"
            strokeDasharray="3,3"
          />
        )}
        {games.map((g, i) => {
          const v = getValue(g);
          const baseline = height - padBottom - (Math.max(0, -min) / range) * (height - padTop - padBottom);
          const h = (Math.abs(v) / range) * (height - padTop - padBottom);
          const x = i * perGame + 3;
          const y = v >= 0 ? baseline - h : baseline;
          return (
            <g key={`${g.date}-${i}`}>
              <rect x={x} y={y} width={barWidth} height={Math.max(h, 1)} rx={2} fill={color} />
              <title>{getTooltip(g)}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
