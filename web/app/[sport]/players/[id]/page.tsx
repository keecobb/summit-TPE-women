import { Fragment } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type {
  PlayerDetail, PlayerTrajectory, PlayerTrajectorySeason, PlayerSplits, OpponentTierSplit,
  PlayerGameLogs, PlayerGameLogRow, RoleTranslation,
} from "@/lib/types";
import { TIERS, tierAbbrev } from "@/lib/types";
import SeasonGameLog from "@/components/SeasonGameLog";
import PlayerCard from "@/components/PlayerCard";
import PerGameProductionCard from "@/components/PerGameProductionCard";
import RoleTranslationCard from "@/components/RoleTranslationCard";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static -- see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes (phase 11i/11j) for the
// full writeup on why `revalidate: 0` is used on every fetch below rather
// than a timer, and why `force-dynamic` alone wasn't a complete fix.
export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "stats", label: "Stats Overview" },
  { key: "splits", label: "Opponent Splits" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Player profile page (phase 13) -- rebuilt into tabs matching the team
// profile page's Overview/Roster/Schedule/Stats Breakdown/Lineup pattern.
// Only the identity header (name, season, thin-sample flag, Project button)
// lives outside the tabs, same as the team page keeps just its h1/subtitle
// outside `OverviewTab` et al. Each tab is its own async component that
// fetches only what it needs, so switching tabs doesn't pull data the
// active view doesn't use.
export default async function PlayerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { sport, id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  const player = await apiFetch<PlayerDetail>(`/${sport}/players/${id}`, { revalidate: 0 });

  return (
    <div>
      <h1>{player.name}</h1>
      <p className="subtitle">
        {player.season} season
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
        <Link className="btn btn-primary" href={`/${sport}/tpe?player_id=${player.player_id}`}>
          Project this player to a school
        </Link>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/${sport}/players/${id}?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab sport={sport} id={id} player={player} />}
      {tab === "stats" && <StatsOverviewTab sport={sport} id={id} player={player} />}
      {tab === "splits" && <SplitsTab sport={sport} id={id} player={player} />}
    </div>
  );
}

async function OverviewTab({ sport, id, player }: { sport: string; id: string; player: PlayerDetail }) {
  // Role Translation (phase 12) -- 404s when there's no real hoop_score_raw
  // for her this season (thin_sample zero-game placeholder row), not an
  // error worth surfacing.
  let roleTranslation: RoleTranslation | null = null;
  try {
    roleTranslation = await apiFetch<RoleTranslation>(`/${sport}/players/${id}/role-translation`, { revalidate: 0 });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  return (
    <div>
      <PlayerCard player={player} />

      <PerGameProductionCard player={player} />

      {roleTranslation && <RoleTranslationCard data={roleTranslation} />}

      <div className="card">
        <h2>
          Key Stats
          <span className="hint" title="Each axis is scaled to a fixed, sensible ceiling for a women's college season (not a percentile or a comparison to other players), purely so the shape stays readable. The real number is always printed at each point.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Not a percentile and not a comparison against the rest of the league -- each axis is capped at a fixed,
          realistic ceiling for a women&apos;s college season (e.g. 28 PPG, 14 RPG, 70% TS), purely so the shape
          stays readable at a glance. The real number is always printed at every point.
        </p>
        <PlayerRadarChart player={player} />
      </div>
    </div>
  );
}

async function StatsOverviewTab({ sport, id, player }: { sport: string; id: string; player: PlayerDetail }) {
  let trajectory: PlayerTrajectory | null = null;
  try {
    trajectory = await apiFetch<PlayerTrajectory>(`/${sport}/players/${id}/trajectory`, { revalidate: 0 });
  } catch (e) {
    // Trajectory 404s if the player has no multi-season history on record --
    // not an error worth showing.
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  // Best 3 games this season by points + rebounds + assists -- a simple,
  // well-understood combined-production read, computed client-side from the
  // same real per-game rows /players/{id}/game-logs already exposes (no new
  // backend endpoint needed). The full chronological list (oldest first) is
  // also kept for the Game-by-Game Production Rating chart below -- the API
  // returns most-recent-first, so it's reversed once here for both uses.
  let bestGames: (PlayerGameLogRow & { combined: number })[] = [];
  let gamesChronological: PlayerGameLogRow[] = [];
  try {
    const logs = await apiFetch<PlayerGameLogs>(`/${sport}/players/${id}/game-logs`, { params: { season: player.season }, revalidate: 0 });
    bestGames = logs.games
      .map((g) => ({ ...g, combined: g.points + g.rebounds + g.assists }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 3);
    gamesChronological = [...logs.games].reverse();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  const hasTrajectory = !!trajectory && trajectory.seasons.length > 0;
  if (!hasTrajectory && gamesChronological.length === 0) {
    return <p className="empty-state">No season history or game log on record for {player.name} yet.</p>;
  }

  const transfers = trajectory ? countTransfers(trajectory) : 0;

  return (
    <div>
      {hasTrajectory && (
        <div className="card">
          <h2>Season by season {transfers > 0 && <span className="pill pill-warn">{transfers} transfer{transfers > 1 ? "s" : ""} on record</span>}</h2>
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
                {trajectory!.seasons.map((s, i) => {
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
                      <SeasonGameLog sport={sport} playerId={player.player_id} season={s.season} />
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {trajectory!.seasons.length > 1 && (
            <>
              <p className="section-note" style={{ marginTop: 16 }}>
                Trend: <strong>{trajectory!.trend}</strong> ({trajectory!.avg_hoop_score_change_per_season > 0 ? "+" : ""}
                {trajectory!.avg_hoop_score_change_per_season.toFixed(1)} Summit Score/season) &middot; {trajectory!.trend_note}
              </p>
              <SeasonTrendChart seasons={trajectory!.seasons} />
            </>
          )}
        </div>
      )}

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
    </div>
  );
}

async function SplitsTab({ sport, id, player }: { sport: string; id: string; player: PlayerDetail }) {
  let splits: PlayerSplits | null = null;
  try {
    splits = await apiFetch<PlayerSplits>(`/${sport}/players/${id}/splits`, { revalidate: 0 });
  } catch (e) {
    // A thin_sample player with zero games this season has nothing to
    // split, not an error worth surfacing.
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  if (!splits || splits.total_games === 0) {
    return <p className="empty-state">No games logged for {player.name} this season to split by opponent strength.</p>;
  }

  return (
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
              <th>FG%</th>
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
  );
}

function SplitRow({ label, row }: { label: string; row: OpponentTierSplit | null }) {
  if (!row) {
    return (
      <tr>
        <td>{label}</td>
        <td colSpan={9} className="section-note">
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
      <td>{row.fg_pct != null ? `${row.fg_pct.toFixed(1)}%` : "--"}</td>
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

// Fixed per-axis scaling ceilings, used only to lay each stat out on a 0-1
// radius so the polygon has a legible shape -- NOT percentiles or a
// comparison against other players (that would need a separate query this
// chart doesn't need). Chosen as a realistic high-end for a women's
// college season per stat. TOPG is inverted (fewer turnovers reaches
// further out) since it's the one stat here where lower is better. The
// real value is always printed at the vertex regardless of how the axis
// is scaled, so the scaling choice never hides the actual number.
const RADAR_AXES: { key: string; label: string; max: number; invert?: boolean; value: (p: PlayerDetail) => number | null }[] = [
  { key: "ppg", label: "PPG", max: 28, value: (p) => p.ppg },
  { key: "rpg", label: "RPG", max: 14, value: (p) => p.rpg },
  { key: "apg", label: "APG", max: 9, value: (p) => p.apg },
  { key: "spg", label: "SPG", max: 4, value: (p) => p.spg },
  { key: "bpg", label: "BPG", max: 4, value: (p) => p.bpg },
  { key: "topg", label: "TOPG", max: 5.5, invert: true, value: (p) => p.topg },
  { key: "ts_pct", label: "TS%", max: 70, value: (p) => (p.ts_pct != null ? p.ts_pct * 100 : null) },
];

// Simple SVG radar/spider chart -- one axis per key stat above, a filled
// polygon connecting this player's real values, 4 reference rings behind
// it (25/50/75/100% of each axis's ceiling) so the shape reads at a
// glance. Same plain-SVG-with-<title>-tooltips approach as SeasonTrendChart
// above, no client-side JS needed.
function PlayerRadarChart({ player }: { player: PlayerDetail }) {
  const size = 360;
  const center = size / 2;
  const radius = 110;
  const labelOffset = 34;
  const n = RADAR_AXES.length;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const points = RADAR_AXES.map((axis, i) => {
    const angle = angleFor(i);
    const raw = axis.value(player);
    let frac = 0;
    if (raw != null) {
      const scaled = axis.invert ? (axis.max - raw) / axis.max : raw / axis.max;
      frac = Math.max(0, Math.min(1, scaled));
    }
    const r = frac * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      labelX: center + (radius + labelOffset) * Math.cos(angle),
      labelY: center + (radius + labelOffset) * Math.sin(angle),
      axis,
      raw,
    };
  });
  const polygon = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map((frac) =>
    RADAR_AXES.map((_, i) => {
      const angle = angleFor(i);
      const r = frac * radius;
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    }).join(" ")
  );

  return (
    // Capped and centered -- on a wide desktop card this SVG would
    // otherwise stretch to fill the full card width (viewBox scales with
    // its container), reading as oversized next to every other chart on
    // the page. The same cap also trims it down slightly on mobile.
    <div style={{ maxWidth: 280, margin: "0 auto" }}>
      <svg width="100%" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Key stats radar chart">
        {rings.map((pts, i) => (
          <polygon key={i} points={pts} fill="none" stroke="var(--border)" strokeWidth={1} />
        ))}
        {RADAR_AXES.map((_, i) => {
          const angle = angleFor(i);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={center + radius * Math.cos(angle)}
              y2={center + radius * Math.sin(angle)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}
        <polygon points={polygon} fill="var(--accent)" fillOpacity={0.25} stroke="var(--accent)" strokeWidth={2} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="var(--accent)" />
            <title>{`${p.axis.label}: ${p.raw != null ? p.raw.toFixed(1) : "--"}`}</title>
            <text x={p.labelX} y={p.labelY - 6} fontSize={11} textAnchor="middle" fill="var(--text-dim)">
              {p.axis.label}
            </text>
            <text x={p.labelX} y={p.labelY + 8} fontSize={12} fontWeight={700} textAnchor="middle" fill="var(--accent)">
              {p.raw != null ? p.raw.toFixed(1) : "--"}
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
