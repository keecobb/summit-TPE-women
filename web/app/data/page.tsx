import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { PlayerLeaderboard, StandoutsLeaderboard, OpponentSplitLeaderboard } from "@/lib/types";
import { LEADERBOARD_STATS, LEADERBOARD_STAT_LABELS, TIERS, tierAbbrev } from "@/lib/types";

const CHARTS_PER_PAGE = 4;
const CHART_TOP_N = 5;
const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_MAX = 50;

interface SP {
  stat?: string;
  level?: string;
  min_games?: string;
  chart_page?: string;
  page?: string;
}

export default async function DataPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const stat = sp.stat ?? "hoop_score";
  const isHoopScore = stat === "hoop_score";

  const totalLeaderboardPages = LEADERBOARD_MAX / LEADERBOARD_PAGE_SIZE;
  const leaderboardPage = Math.min(
    totalLeaderboardPages - 1,
    Math.max(0, Number(sp.page ?? 0) || 0)
  );

  const chartPage = Math.max(0, Number(sp.chart_page ?? 0) || 0);
  const chartStats = LEADERBOARD_STATS.filter((s) => s !== "hoop_score");
  const totalChartPages = Math.ceil(chartStats.length / CHARTS_PER_PAGE);
  const pageStats = chartStats.slice(chartPage * CHARTS_PER_PAGE, chartPage * CHARTS_PER_PAGE + CHARTS_PER_PAGE);

  const [leaderboard, lmStandouts, mmStandouts, hmVsHm, lmVsHm, mmVsHm, ...chartData] = await Promise.all([
    apiFetch<PlayerLeaderboard>("/leaderboards/players", {
      params: { stat, level: sp.level, min_games: sp.min_games ?? 8, limit: LEADERBOARD_MAX },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Low-Major", target_level: "High-Major", limit: 8 },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Mid-Major", target_level: "High-Major", limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "High-Major", opponent_level: "High-Major", stat: "points", min_games: 5, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Low-Major", opponent_level: "High-Major", stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Mid-Major", opponent_level: "High-Major", stat: "points", min_games: 2, limit: 8 },
    }),
    ...pageStats.map((s) =>
      apiFetch<PlayerLeaderboard>("/leaderboards/players", { params: { stat: s, min_games: 8, limit: CHART_TOP_N } })
    ),
  ]);

  return (
    <div>
      <h1>Data</h1>
      <p className="subtitle">Real season leaderboards and standout projections -- for coaches and fans alike.</p>

      <div className="card">
        <h2>Leaderboard</h2>
        <form className="filter-form" action="/data">
          <div className="field">
            <label htmlFor="stat">Stat</label>
            <select id="stat" name="stat" defaultValue={stat}>
              {LEADERBOARD_STATS.map((s) => (
                <option key={s} value={s}>
                  {LEADERBOARD_STAT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="level">Level</label>
            <select id="level" name="level" defaultValue={sp.level ?? ""}>
              <option value="">Whole league</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} ({tierAbbrev(t)})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="min_games">Min. games</label>
            <input id="min_games" name="min_games" type="number" min={0} defaultValue={sp.min_games ?? "8"} />
          </div>
          <button className="btn btn-primary" type="submit">
            Update
          </button>
        </form>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Team</th>
                <th>Level</th>
                <th>
                  {leaderboard.stat_label}
                  {isHoopScore && (
                    <span className="hint" title="Summit Score normalizes a player's per-40 production for role and opponent strength -- a single number for 'how good is this production, in context,' not just raw box-score totals.">
                      ?
                    </span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.players
                .slice(leaderboardPage * LEADERBOARD_PAGE_SIZE, leaderboardPage * LEADERBOARD_PAGE_SIZE + LEADERBOARD_PAGE_SIZE)
                .map((p, i) => (
                  <tr key={p.player_id}>
                    <td>{leaderboardPage * LEADERBOARD_PAGE_SIZE + i + 1}</td>
                    <td>
                      <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                    </td>
                    <td>{p.team_name}</td>
                    <td>
                      <span className="pill" title={p.tier}>{tierAbbrev(p.tier)}</span>
                    </td>
                    <td>{p.stat_value.toFixed(stat === "ts_pct" || stat === "fg_pct" ? 1 : 2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{ marginTop: 12 }}>
          {leaderboardPage > 0 && (
            <Link className="btn" href={`/data?${withLeaderboardPage(sp, leaderboardPage - 1)}`}>
              &larr; Previous
            </Link>
          )}
          <span className="section-note" style={{ margin: "0 4px" }}>
            Page {leaderboardPage + 1} of {Math.min(totalLeaderboardPages, Math.ceil(leaderboard.players.length / LEADERBOARD_PAGE_SIZE) || 1)}
          </span>
          {leaderboardPage < totalLeaderboardPages - 1 &&
            (leaderboardPage + 1) * LEADERBOARD_PAGE_SIZE < leaderboard.players.length && (
              <Link className="btn" href={`/data?${withLeaderboardPage(sp, leaderboardPage + 1)}`}>
                Next &rarr;
              </Link>
            )}
        </div>
        <p className="section-note" style={{ marginTop: 12 }}>
          Want to see how these stats stack up visually? Scroll down to Category Leaderboards below.
        </p>
      </div>

      <div className="card">
        <h2>Category Leaderboards</h2>
        <p className="section-note">
          A quick visual scan across categories -- top {CHART_TOP_N} in each, min. 8 games played. Page{" "}
          {chartPage + 1} of {totalChartPages}.
        </p>
        <div className="chart-grid">
          {pageStats.map((s, i) => (
            <ChartCard key={s} stat={s} data={chartData[i]} />
          ))}
        </div>
        <div className="pagination">
          {chartPage > 0 && (
            <Link className="btn" href={`/data?${withChartPage(sp, chartPage - 1)}`}>
              &larr; Previous
            </Link>
          )}
          {chartPage < totalChartPages - 1 && (
            <Link className="btn" href={`/data?${withChartPage(sp, chartPage + 1)}`}>
              Next &rarr;
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Standouts Projected at the High-Major Level</h2>
        <p className="section-note">{lmStandouts.synthetic_target_note}</p>
        <div className="card-grid card-grid-2">
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major &rarr; High-Major</h2>
            <StandoutTable data={lmStandouts} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major &rarr; High-Major</h2>
            <StandoutTable data={mmStandouts} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          Who Performs Best Against High-Major Competition
          <span className="hint" title="Real per-game scoring specifically in games played against High-Major opponents this season -- not a projection, not a season average. Each player's own team's level is noted next to her name.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Actual production in real games against High-Major opponents, not a projection -- each game&apos;s
          opponent is tracked individually, so this is what actually happened, not an estimate.
        </p>
        <div className="card-grid card-grid-3">
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>HM vs. HM</h2>
            <OpponentSplitTable data={hmVsHm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major vs. HM</h2>
            <OpponentSplitTable data={lmVsHm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major vs. HM</h2>
            <OpponentSplitTable data={mmVsHm} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ stat, data }: { stat: string; data: PlayerLeaderboard }) {
  const max = Math.max(...data.players.map((p) => p.stat_value), 0.0001);
  const decimals = stat === "ts_pct" || stat === "fg_pct" ? 1 : 1;
  return (
    <div className="chart-card">
      <h3>{LEADERBOARD_STAT_LABELS[stat]}</h3>
      <div className="chart-sub">Top {data.players.length}, min. 8 GP</div>
      {data.players.length === 0 ? (
        <p className="empty-state" style={{ padding: "12px 0" }}>
          No qualifying players.
        </p>
      ) : (
        data.players.map((p) => (
          <div className="bar-row" key={p.player_id}>
            <Link href={`/players/${p.player_id}`} className="bar-name" title={`${p.name} (${p.team_name})`}>
              {p.name}
            </Link>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(p.stat_value / max) * 100}%` }} />
            </div>
            <div className="bar-value">{p.stat_value.toFixed(decimals)}</div>
          </div>
        ))
      )}
    </div>
  );
}

function StandoutTable({ data }: { data: StandoutsLeaderboard }) {
  if (data.players.length === 0) return <p className="empty-state">No qualifying players.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Current</th>
            <th>
              Proj. Summit Score
              <span className="hint" title="What this player's Summit Score projects to if placed on an average High-Major roster, using the same model as the TPE Engine.">
                ?
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.players.map((p) => (
            <tr key={p.player_id}>
              <td>
                <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                <div className="label" style={{ marginTop: 2 }}>
                  {p.current_team}
                </div>
              </td>
              <td>{p.current_hoop_score.toFixed(1)}</td>
              <td style={{ color: "var(--accent)", fontWeight: 700 }}>{p.projected_hoop_score.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpponentSplitTable({ data }: { data: OpponentSplitLeaderboard }) {
  if (data.players.length === 0) return <p className="empty-state">No qualifying players.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>GP</th>
            <th>PPG</th>
          </tr>
        </thead>
        <tbody>
          {data.players.map((p) => (
            <tr key={p.player_id}>
              <td>
                <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                <div className="label" style={{ marginTop: 2 }}>
                  {p.team_name}
                </div>
              </td>
              <td>{p.games_vs_opponent}</td>
              <td style={{ color: "var(--accent)", fontWeight: 700 }}>{p.avg_points.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function withChartPage(sp: SP, page: number): string {
  const p = new URLSearchParams();
  if (sp.stat) p.set("stat", sp.stat);
  if (sp.level) p.set("level", sp.level);
  if (sp.min_games) p.set("min_games", sp.min_games);
  if (sp.page) p.set("page", sp.page);
  p.set("chart_page", String(page));
  return p.toString();
}

function withLeaderboardPage(sp: SP, page: number): string {
  const p = new URLSearchParams();
  if (sp.stat) p.set("stat", sp.stat);
  if (sp.level) p.set("level", sp.level);
  if (sp.min_games) p.set("min_games", sp.min_games);
  if (sp.chart_page) p.set("chart_page", sp.chart_page);
  p.set("page", String(page));
  return p.toString();
}
