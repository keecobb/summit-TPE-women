import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { PlayerLeaderboard, StandoutsLeaderboard, OpponentSplitLeaderboard } from "@/lib/types";
import { LEADERBOARD_STATS, LEADERBOARD_STAT_LABELS } from "@/lib/types";

const CHARTS_PER_PAGE = 4;
const CHART_TOP_N = 5;

interface SP {
  stat?: string;
  level?: string;
  min_games?: string;
  chart_page?: string;
}

export default async function DataPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const stat = sp.stat ?? "hoop_score";
  const isHoopScore = stat === "hoop_score";

  const chartPage = Math.max(0, Number(sp.chart_page ?? 0) || 0);
  const chartStats = LEADERBOARD_STATS.filter((s) => s !== "hoop_score");
  const totalChartPages = Math.ceil(chartStats.length / CHARTS_PER_PAGE);
  const pageStats = chartStats.slice(chartPage * CHARTS_PER_PAGE, chartPage * CHARTS_PER_PAGE + CHARTS_PER_PAGE);

  const [leaderboard, lmStandouts, mmStandouts, p5VsP5, lmVsP5, mmVsP5, ...chartData] = await Promise.all([
    apiFetch<PlayerLeaderboard>("/leaderboards/players", {
      params: { stat, level: sp.level, min_games: sp.min_games ?? 8, limit: 25 },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Low-Major", target_level: "P5", limit: 8 },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Mid-Major", target_level: "P5", limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "P5", opponent_level: "P5", stat: "points", min_games: 5, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Low-Major", opponent_level: "P5", stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Mid-Major", opponent_level: "P5", stat: "points", min_games: 2, limit: 8 },
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
              <option value="P5">P5</option>
              <option value="Mid-Major">Mid-Major</option>
              <option value="Low-Major">Low-Major</option>
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
              {leaderboard.players.map((p, i) => (
                <tr key={p.player_id}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                  </td>
                  <td>{p.team_name}</td>
                  <td>
                    <span className="pill">{p.tier}</span>
                  </td>
                  <td>{p.stat_value.toFixed(stat === "ts_pct" || stat === "fg_pct" ? 1 : 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <h2>Standouts Projected at the P5 Level</h2>
        <p className="section-note">{lmStandouts.synthetic_target_note}</p>
        <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major &rarr; P5</h2>
            <StandoutTable data={lmStandouts} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major &rarr; P5</h2>
            <StandoutTable data={mmStandouts} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          Who Performs Best Against P5 Competition
          <span className="hint" title="Real per-game scoring specifically in games played against P5 opponents this season -- not a projection, not a season average. Each player's own team's level is noted next to her name.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Actual production in real games against P5 opponents, not a projection -- each game&apos;s opponent is
          tracked individually, so this is what actually happened, not an estimate.
        </p>
        <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>P5 vs. P5</h2>
            <OpponentSplitTable data={p5VsP5} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major vs. P5</h2>
            <OpponentSplitTable data={lmVsP5} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major vs. P5</h2>
            <OpponentSplitTable data={mmVsP5} />
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
            <div className="bar-name" title={`${p.name} (${p.team_name})`}>
              {p.name}
            </div>
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
              <span className="hint" title="What this player's Summit Score projects to if placed on an average P5 roster, using the same model as the TPE Engine.">
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
  p.set("chart_page", String(page));
  return p.toString();
}
