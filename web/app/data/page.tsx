import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type {
  PlayerLeaderboard, StandoutsLeaderboard, OpponentSplitLeaderboard, BackHalfLeaderboard,
} from "@/lib/types";
import { LEADERBOARD_STATS, LEADERBOARD_STAT_LABELS, TIERS, tierAbbrev } from "@/lib/types";

const CHARTS_PER_PAGE = 4;
const CHART_TOP_N = 5;
const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_MAX = 50;

interface SP {
  stat?: string;
  level?: string;
  min_games?: string;
  conference?: string;
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

  const [
    leaderboard, lmStandouts, mmStandouts, hmVsHm, lmVsHm, mmVsHm,
    top50Hm, top50Mm, top50Lm, backHalf, conferences, ...chartData
  ] = await Promise.all([
    apiFetch<PlayerLeaderboard>("/leaderboards/players", {
      params: { stat, level: sp.level, conference: sp.conference, min_games: sp.min_games ?? 8, limit: LEADERBOARD_MAX },
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
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { opponent_level: "High-Major", top50_only: true, stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { opponent_level: "Mid-Major", top50_only: true, stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { opponent_level: "Low-Major", top50_only: true, stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<BackHalfLeaderboard>("/leaderboards/back-half", { params: { min_games_per_half: 5, limit: 10 } }),
    apiFetch<string[]>("/conferences"),
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
            <label htmlFor="conference">Conference</label>
            <select id="conference" name="conference" defaultValue={sp.conference ?? ""}>
              <option value="">Any conference</option>
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
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

      <div className="card">
        <h2>
          Best Against the Top 50 Teams, by Tier
          <span className="hint" title="Real per-game scoring against only the 50 highest-current_rating teams WITHIN each tier -- not every team at that tier, including its weakest. High-Major's top 50 is nearly the whole tier; Low-Major's top 50 is a much sharper cut of a much bigger pool.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Real production against just the best 50 teams in each tier (by current rating), not every team at
          that level -- a sharper read than the whole-tier splits above, especially for Mid-Major and Low-Major.
        </p>
        <div className="card-grid card-grid-3">
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Top 50 High-Major</h2>
            <OpponentSplitTable data={top50Hm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Top 50 Mid-Major</h2>
            <OpponentSplitTable data={top50Mm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Top 50 Low-Major</h2>
            <OpponentSplitTable data={top50Lm} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          Best Back Half of the Season
          <span className="hint" title="Each player's own games are split at the midpoint of HER games played this season (not the calendar midpoint), then compared -- a missed-games stretch early in the year doesn't skew this the way splitting by calendar date would.">
            ?
          </span>
        </h2>
        <p className="section-note">{backHalf.note}</p>
        {backHalf.players.length === 0 ? (
          <p className="empty-state">No qualifying players.</p>
        ) : (
          <div className="chart-card" style={{ maxWidth: 640 }}>
            <div className="chart-sub">
              PPG change, first half &rarr; second half (min. {backHalf.min_games_per_half} games each half)
            </div>
            {(() => {
              const max = Math.max(...backHalf.players.map((p) => Math.abs(p.ppg_change)), 0.0001);
              return backHalf.players.map((p) => (
                <div className="bar-row" key={p.player_id}>
                  <Link href={`/players/${p.player_id}`} className="bar-name" title={`${p.name} (${p.team_name})`}>
                    {p.name}
                  </Link>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(Math.abs(p.ppg_change) / max) * 100}%`,
                        background: p.ppg_change < 0 ? "var(--text-dim)" : undefined,
                      }}
                    />
                  </div>
                  <div className="bar-value">
                    {p.ppg_change > 0 ? "+" : ""}
                    {p.ppg_change.toFixed(1)}
                  </div>
                </div>
              ));
            })()}
            <p className="section-note" style={{ marginTop: 10 }}>
              1st half {backHalf.players[0]?.first_half_ppg.toFixed(1)} PPG &rarr; 2nd half{" "}
              {backHalf.players[0]?.second_half_ppg.toFixed(1)} PPG for the top mover.
            </p>
          </div>
        )}
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
  if (sp.conference) p.set("conference", sp.conference);
  if (sp.min_games) p.set("min_games", sp.min_games);
  if (sp.page) p.set("page", sp.page);
  p.set("chart_page", String(page));
  return p.toString();
}

function withLeaderboardPage(sp: SP, page: number): string {
  const p = new URLSearchParams();
  if (sp.stat) p.set("stat", sp.stat);
  if (sp.level) p.set("level", sp.level);
  if (sp.conference) p.set("conference", sp.conference);
  if (sp.min_games) p.set("min_games", sp.min_games);
  if (sp.chart_page) p.set("chart_page", sp.chart_page);
  p.set("page", String(page));
  return p.toString();
}
