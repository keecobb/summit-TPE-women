import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type {
  PlayerLeaderboard, StandoutsLeaderboard, OpponentSplitLeaderboard, BackHalfLeaderboardAll, BackHalfPlayer,
  SeasonJumpLeaderboard, TeamEfficiencyQuadrant, PlayerEfficiencyQuadrant, BestGamesLeaderboard,
} from "@/lib/types";
import { LEADERBOARD_STATS, LEADERBOARD_STAT_LABELS, CLASS_YEARS, POSITIONS, TIERS, tierAbbrev } from "@/lib/types";
import FilterForm from "@/components/FilterForm";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_MAX = 50;

interface SP {
  stat?: string;
  level?: string;
  min_games?: string;
  conference?: string;
  class_year?: string;
  position?: string;
  page?: string;
  eff_level?: string;
  peff_level?: string;
  games_sort?: string;
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

  const [
    leaderboard, lmStandouts, mmStandouts, hmVsHm, mmVsHm, lmVsHm,
    top50Hm, top50Mm, top50Lm, backHalfAll, seasonJump, efficiency, playerEfficiency, bestGames, conferences,
  ] = await Promise.all([
    apiFetch<PlayerLeaderboard>("/leaderboards/players", {
      params: {
        stat, level: sp.level, conference: sp.conference, class_year: sp.class_year, position: sp.position,
        min_games: sp.min_games ?? 8, limit: LEADERBOARD_MAX,
      },
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
      params: { own_level: "Mid-Major", opponent_level: "High-Major", stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Low-Major", opponent_level: "High-Major", stat: "points", min_games: 2, limit: 8 },
    }),
    // top50_national (not top50_only): each column is "[level] players
    // against the best 50 teams IN THE COUNTRY," not the best 50 within
    // their own level -- own_level still picks which level of PLAYER each
    // column is about, but the opponent pool is the same national top 50
    // across all three columns. (top50_only's level-scoped version made
    // Low-Major's "top 50" a much softer bar than High-Major's, since a
    // level's own top 50 isn't the same quality of competition level to
    // level -- this is the sharper, genuinely-comparable read.)
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "High-Major", top50_national: true, stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Mid-Major", top50_national: true, stat: "points", min_games: 2, limit: 8 },
    }),
    apiFetch<OpponentSplitLeaderboard>("/leaderboards/opponent-splits", {
      params: { own_level: "Low-Major", top50_national: true, stat: "points", min_games: 2, limit: 8 },
    }),
    // One call, sort=all -- the backend computes all 6 rankings (PPG/RPG/
    // APG/TS%/MPG/TOPG) from a single full-season scan/aggregation instead
    // of redoing that scan once per stat. An earlier version of this made 4
    // separate back-half calls (one per stat) to fix the "same girls in
    // every section" bug -- correct in isolation, but it roughly doubled
    // this page's slowest, most expensive backend call and was enough
    // added latency to time the whole page out in production. sort=all
    // keeps the genuinely-distinct-lists fix at the original 1-call cost.
    // min_games=15/min_mpg=10 keep this to real rotation players, not
    // small-sample noise from someone who barely played.
    apiFetch<BackHalfLeaderboardAll>("/leaderboards/back-half", {
      params: { min_games_per_half: 5, min_games: 15, min_mpg: 10, limit: 10, sort: "all" },
    }),
    // Real season-over-season comparison (player_history), not a
    // projection -- defaults to the two most recent seasons on record.
    apiFetch<SeasonJumpLeaderboard>("/leaderboards/season-jump", {
      params: { min_games: 8, limit: 15 },
    }),
    // Real points scored/allowed per game (not a projection, not pace-
    // adjusted) -- powers the quadrant scatter chart below.
    apiFetch<TeamEfficiencyQuadrant>("/leaderboards/team-efficiency", {
      params: { level: sp.eff_level, min_games: 5 },
    }),
    // Real PPG (volume) vs. TS% (efficiency) -- the player-level
    // counterpart to the team quadrant chart above.
    apiFetch<PlayerEfficiencyQuadrant>("/leaderboards/player-efficiency", {
      params: { level: sp.peff_level, min_games: 8 },
    }),
    // Real single-game box scores, not a season average -- the best
    // individual performances this season, site-wide.
    apiFetch<BestGamesLeaderboard>("/leaderboards/best-games", {
      params: { sort: sp.games_sort ?? "points", limit: 10 },
    }),
    apiFetch<string[]>("/conferences"),
  ]);

  return (
    <div>
      <h1>Data</h1>
      <p className="subtitle">Real season leaderboards and standout projections -- for coaches and fans alike.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Everything above the Standouts section is real, already-happened production this season -- no
        projection involved. Standouts and Back Half further down mix in the site's projection model and a
        real season-over-season split, respectively; each section says which kind it is. Use the Leaderboard
        filters to slice by stat, level, conference, class, position, or minimum games played.
      </p>

      <div className="card">
        <h2>Leaderboard</h2>
        <FilterForm className="filter-form" action="/data">
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
            <label htmlFor="class_year">Class</label>
            <select id="class_year" name="class_year" defaultValue={sp.class_year ?? ""}>
              <option value="">Any class</option>
              {CLASS_YEARS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="position">Position</label>
            <select id="position" name="position" defaultValue={sp.position ?? ""}>
              <option value="">Any position</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
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
        </FilterForm>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Team</th>
                <th>Level</th>
                <th>Pos</th>
                <th>Class</th>
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
                    <td>{p.position}</td>
                    <td>{p.class_year}</td>
                    <td>{p.stat_value.toFixed(stat.endsWith("_pct") ? 1 : stat.startsWith("total_") ? 0 : 2)}</td>
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
      </div>

      <div className="card">
        <h2>
          Team Efficiency: Offense vs. Defense
          <span className="hint" title={efficiency.note}>
            ?
          </span>
        </h2>
        <p className="section-note">
          Every {efficiency.level_filter ?? "D1"} team, plotted by real points scored per game (offense) against
          real points allowed per game (defense) -- {efficiency.season}, min. {efficiency.min_games} games. This
          is raw per-game scoring, not adjusted for pace or opponent strength the way Rating is -- a fast, weak
          team and a slow, elite team can land in the same spot on the offense axis for very different reasons.
          The quadrant lines split at this group&apos;s own average ({efficiency.mean_ppg} scored,{" "}
          {efficiency.mean_papg} allowed), not a fixed number, so a Low-Major-only view splits at the Low-Major
          average, not the whole-league one.
        </p>
        <FilterForm className="filter-form" action="/data" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="eff_level">Level</label>
            <select id="eff_level" name="eff_level" defaultValue={sp.eff_level ?? ""}>
              <option value="">Whole league</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} ({tierAbbrev(t)})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Update
          </button>
        </FilterForm>
        <TeamQuadrantChart data={efficiency} />
      </div>

      <div className="card">
        <h2>
          Player Efficiency: Volume vs. Scoring Efficiency
          <span className="hint" title={playerEfficiency.note}>
            ?
          </span>
        </h2>
        <p className="section-note">
          Every {playerEfficiency.level_filter ?? "D1"} player with real minutes, plotted by points per game
          (scoring volume) against true shooting % (scoring efficiency) this season -- real season stats, not a
          projection. The quadrant lines split at this group&apos;s own average ({playerEfficiency.mean_ppg} PPG,{" "}
          {(playerEfficiency.mean_ts * 100).toFixed(1)}% TS), not a fixed number.
        </p>
        <FilterForm className="filter-form" action="/data" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="peff_level">Level</label>
            <select id="peff_level" name="peff_level" defaultValue={sp.peff_level ?? ""}>
              <option value="">Whole league</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} ({tierAbbrev(t)})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Update
          </button>
        </FilterForm>
        <PlayerQuadrantChart data={playerEfficiency} />
      </div>

      <div className="card">
        <h2>
          Best Single-Game Performances
          <span className="hint" title={bestGames.note}>
            ?
          </span>
        </h2>
        <p className="section-note">
          The best individual games this season, site-wide -- real box scores, not season averages.{" "}
          {bestGames.season}.
        </p>
        <FilterForm className="filter-form" action="/data" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="games_sort">Ranked by</label>
            <select id="games_sort" name="games_sort" defaultValue={sp.games_sort ?? "points"}>
              <option value="points">Points</option>
              <option value="rebounds">Rebounds</option>
              <option value="assists">Assists</option>
              <option value="production_rating">Production Rating</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Update
          </button>
        </FilterForm>
        <BestGamesTable data={bestGames} />
      </div>

      <div className="card">
        <h2>
          Biggest Summit Score Jump: {seasonJump.season_from} &rarr; {seasonJump.season_to}
          <span className="hint" title={seasonJump.note}>
            ?
          </span>
        </h2>
        <p className="section-note">{seasonJump.note}</p>
        <SeasonJumpTable data={seasonJump} />
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
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major vs. HM</h2>
            <OpponentSplitTable data={mmVsHm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major vs. HM</h2>
            <OpponentSplitTable data={lmVsHm} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          Best Against the Top 50 Teams Nationally, by Level
          <span className="hint" title="Real per-game scoring against only the 50 highest-current_rating teams IN THE COUNTRY, regardless of tier -- the same 50 opponent teams in all three columns below. Each column restricts to players who are themselves at that level, so you can see how High-Major, Mid-Major, and Low-Major players each perform against genuinely elite competition, not just the best of their own level.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Real production against the same 50 best teams in the country (by current rating) for every column --
          restricted to players whose own team is at that level. Since the national top 50 is almost entirely
          High-Major teams, this is a much tougher bar for Mid-Major and Low-Major players than &quot;best of
          their own level&quot; would be -- a genuinely apples-to-apples read of who travels well against real
          elite competition.
        </p>
        <div className="card-grid card-grid-3">
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>High-Major players</h2>
            <OpponentSplitTable data={top50Hm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major players</h2>
            <OpponentSplitTable data={top50Mm} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major players</h2>
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
        <p className="section-note">
          Each half-season split is at the midpoint of a player&apos;s OWN games played (not the calendar
          midpoint), so a missed-games stretch early in the year doesn&apos;t skew this the way splitting by
          calendar date would. Each chart below is ranked by its own stat&apos;s change -- these are six
          distinct lists of top movers, not the same players re-labeled. Limited to players with at least{" "}
          {backHalfAll.min_games} games and {backHalfAll.min_mpg} minutes per game this season, so this
          reflects real rotation players.
        </p>
        {backHalfAll.by_sort.ppg.length === 0 &&
        backHalfAll.by_sort.rpg.length === 0 &&
        backHalfAll.by_sort.apg.length === 0 &&
        backHalfAll.by_sort.ts.length === 0 &&
        backHalfAll.by_sort.mpg.length === 0 &&
        backHalfAll.by_sort.topg.length === 0 ? (
          <p className="empty-state">No qualifying players.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <BackHalfChangeChart
              title="PPG change"
              sub={`Top movers -- first half → second half (min. ${backHalfAll.min_games_per_half} games each half)`}
              players={backHalfAll.by_sort.ppg}
              getChange={(p) => p.ppg_change}
              getFirst={(p) => p.first_half_ppg}
              getSecond={(p) => p.second_half_ppg}
              unit="PPG"
            />
            <BackHalfChangeChart
              title="RPG change"
              sub="Top movers, rebounds per game"
              players={backHalfAll.by_sort.rpg}
              getChange={(p) => p.rpg_change}
              getFirst={(p) => p.first_half_rpg}
              getSecond={(p) => p.second_half_rpg}
              unit="RPG"
            />
            <BackHalfChangeChart
              title="APG change"
              sub="Top movers, assists per game"
              players={backHalfAll.by_sort.apg}
              getChange={(p) => p.apg_change}
              getFirst={(p) => p.first_half_apg}
              getSecond={(p) => p.second_half_apg}
              unit="APG"
            />
            <BackHalfChangeChart
              title="TS% change"
              sub="Top movers, true shooting % (needs 8+ true-shot attempts in a half to compute)"
              players={backHalfAll.by_sort.ts}
              getChange={(p) => p.ts_pct_change as number}
              getFirst={(p) => p.first_half_ts_pct as number}
              getSecond={(p) => p.second_half_ts_pct as number}
              unit="TS%"
            />
            <BackHalfChangeChart
              title="MPG change"
              sub="Top movers, minutes per game -- whose role is trending up"
              players={backHalfAll.by_sort.mpg}
              getChange={(p) => p.mpg_change}
              getFirst={(p) => p.first_half_mpg}
              getSecond={(p) => p.second_half_mpg}
              unit="MPG"
            />
            <BackHalfChangeChart
              title="TOPG improvement"
              sub="Biggest drop in turnovers per game -- most improved ball security"
              players={backHalfAll.by_sort.topg}
              getChange={(p) => -p.topg_change}
              getFirst={(p) => p.first_half_topg}
              getSecond={(p) => p.second_half_topg}
              unit="TOPG"
            />
          </div>
        )}
      </div>

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
              <span className="hint" title="What this player's Summit Score projects to if placed on an average High-Major roster, using the same model as Transfer Projection.">
                ?
              </span>
            </th>
            <th>
              Proj. Min
              <span className="hint" title="Each player's own auto-projected minutes at the synthetic target's strength (her current minutes, scaled for the level jump) -- not a specific target team's rotation, since the target here is a synthetic average team, not a real roster.">
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
              <td>{p.projected_minutes.toFixed(1)}</td>
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
            <th>RPG</th>
            <th>APG</th>
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
              <td>{p.avg_rebounds.toFixed(1)}</td>
              <td>{p.avg_assists.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIER_COLOR: Record<string, string> = {
  "High-Major": "var(--accent)",
  "Mid-Major": "var(--good)",
  "Low-Major": "var(--text-dim)",
};

// Scatter/quadrant chart -- every qualifying team plotted by real points
// scored (x) vs. real points allowed (y, inverted so "up" = fewer points
// allowed = better defense). Quadrant divider lines sit at the group's own
// mean, not a fixed constant, matching what the backend note says. Colored
// by level rather than a single hue since with 300+ points on one plot,
// level is the one grouping a coach actually wants to visually separate at
// a glance; a small legend below explains the colors. Hover-only (native
// <title>) rather than click-through, consistent with this site's other
// dense scatter/bar charts (GameByGameChart, SeasonTrendChart).
function TeamQuadrantChart({ data }: { data: TeamEfficiencyQuadrant }) {
  const width = 720;
  const height = 480;
  const padLeft = 54;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 44;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const ppgVals = data.teams.map((t) => t.ppg);
  const papgVals = data.teams.map((t) => t.papg);
  const minPpg = Math.min(...ppgVals) - 2;
  const maxPpg = Math.max(...ppgVals) + 2;
  const minPapg = Math.min(...papgVals) - 2;
  const maxPapg = Math.max(...papgVals) + 2;

  const x = (ppg: number) => padLeft + ((ppg - minPpg) / (maxPpg - minPpg)) * plotW;
  // Inverted: low points-allowed (good defense) plots near the TOP.
  const y = (papg: number) => padTop + ((papg - minPapg) / (maxPapg - minPapg)) * plotH;

  const midX = x(data.mean_ppg);
  const midY = y(data.mean_papg);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Team offense vs defense quadrant chart" style={{ minWidth: 560 }}>
          {/* Quadrant divider lines */}
          <line x1={midX} x2={midX} y1={padTop} y2={height - padBottom} stroke="var(--border)" strokeDasharray="4,4" />
          <line x1={padLeft} x2={width - padRight} y1={midY} y2={midY} stroke="var(--border)" strokeDasharray="4,4" />

          {/* Quadrant labels */}
          <text x={width - padRight - 6} y={padTop + 16} fontSize={12} textAnchor="end" fill="var(--text-dim)">Elite</text>
          <text x={width - padRight - 6} y={height - padBottom - 8} fontSize={12} textAnchor="end" fill="var(--text-dim)">Offense-First</text>
          <text x={padLeft + 6} y={padTop + 16} fontSize={12} textAnchor="start" fill="var(--text-dim)">Defense-First</text>
          <text x={padLeft + 6} y={height - padBottom - 8} fontSize={12} textAnchor="start" fill="var(--text-dim)">Below Average</text>

          {/* Axis labels */}
          <text x={padLeft + plotW / 2} y={height - 8} fontSize={12} textAnchor="middle" fill="var(--text-dim)">
            Points scored per game (offense) &rarr;
          </text>
          <text
            x={-(padTop + plotH / 2)}
            y={14}
            fontSize={12}
            textAnchor="middle"
            fill="var(--text-dim)"
            transform="rotate(-90)"
          >
            &uarr; Points allowed per game (better defense)
          </text>

          {data.teams.map((t) => (
            <circle
              key={t.team_id}
              cx={x(t.ppg)}
              cy={y(t.papg)}
              r={3.5}
              fill={TIER_COLOR[t.tier] ?? "var(--accent)"}
              fillOpacity={0.75}
            >
              <title>{`${t.name} (${t.tier}) -- ${t.ppg} PPG scored, ${t.papg} PPG allowed, ${t.quadrant} (${t.games} GP)`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {TIERS.map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-dim)" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: TIER_COLOR[t], display: "inline-block" }} />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

// Player-level counterpart to TeamQuadrantChart -- PPG (x) vs. TS% (y), no
// axis inversion needed since higher TS% is already "up is good," unlike
// the team chart's points-allowed axis. ts_pct arrives as a 0-1 fraction
// (matching every other ts_pct field in this API) so it's scaled to a
// percentage at render time here.
function PlayerQuadrantChart({ data }: { data: PlayerEfficiencyQuadrant }) {
  const width = 720;
  const height = 480;
  const padLeft = 54;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 44;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const ppgVals = data.players.map((p) => p.ppg);
  const tsVals = data.players.map((p) => p.ts_pct * 100);
  const minPpg = Math.max(0, Math.min(...ppgVals) - 2);
  const maxPpg = Math.max(...ppgVals) + 2;
  const minTs = Math.max(0, Math.min(...tsVals) - 5);
  const maxTs = Math.max(...tsVals) + 5;

  const x = (ppg: number) => padLeft + ((ppg - minPpg) / (maxPpg - minPpg)) * plotW;
  const y = (ts: number) => padTop + plotH - ((ts - minTs) / (maxTs - minTs)) * plotH;

  const midX = x(data.mean_ppg);
  const midY = y(data.mean_ts * 100);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player scoring volume vs efficiency quadrant chart" style={{ minWidth: 560 }}>
          <line x1={midX} x2={midX} y1={padTop} y2={height - padBottom} stroke="var(--border)" strokeDasharray="4,4" />
          <line x1={padLeft} x2={width - padRight} y1={midY} y2={midY} stroke="var(--border)" strokeDasharray="4,4" />

          <text x={width - padRight - 6} y={padTop + 16} fontSize={12} textAnchor="end" fill="var(--text-dim)">Elite</text>
          <text x={width - padRight - 6} y={height - padBottom - 8} fontSize={12} textAnchor="end" fill="var(--text-dim)">Volume Scorer</text>
          <text x={padLeft + 6} y={padTop + 16} fontSize={12} textAnchor="start" fill="var(--text-dim)">Efficient</text>
          <text x={padLeft + 6} y={height - padBottom - 8} fontSize={12} textAnchor="start" fill="var(--text-dim)">Below Average</text>

          <text x={padLeft + plotW / 2} y={height - 8} fontSize={12} textAnchor="middle" fill="var(--text-dim)">
            Points per game (volume) &rarr;
          </text>
          <text
            x={-(padTop + plotH / 2)}
            y={14}
            fontSize={12}
            textAnchor="middle"
            fill="var(--text-dim)"
            transform="rotate(-90)"
          >
            &uarr; True shooting % (efficiency)
          </text>

          {data.players.map((p) => (
            <circle
              key={p.player_id}
              cx={x(p.ppg)}
              cy={y(p.ts_pct * 100)}
              r={3.5}
              fill={TIER_COLOR[p.tier] ?? "var(--accent)"}
              fillOpacity={0.75}
            >
              <title>{`${p.name} (${p.team_name}, ${p.tier}) -- ${p.ppg.toFixed(1)} PPG, ${(p.ts_pct * 100).toFixed(1)}% TS, ${p.quadrant}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {TIERS.map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-dim)" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: TIER_COLOR[t], display: "inline-block" }} />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function BestGamesTable({ data }: { data: BestGamesLeaderboard }) {
  if (data.games.length === 0) return <p className="empty-state">No qualifying games.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Date</th>
            <th>Opponent</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th>
              Production
              <span className="hint" title="Points + rebounds + assists + steals + blocks - turnovers for that one game.">
                ?
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.games.map((g, i) => (
            <tr key={`${g.player_id}-${g.date}-${i}`}>
              <td>
                <Link href={`/players/${g.player_id}`}>{g.name}</Link>
                <div className="label" style={{ marginTop: 2 }}>
                  {g.team_name}
                </div>
              </td>
              <td>{formatGameDate(g.date)}</td>
              <td>{g.opponent_name ?? "--"}</td>
              <td style={data.sort === "points" ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
                {g.points}
              </td>
              <td>{g.rebounds}</td>
              <td>{g.assists}</td>
              <td style={data.sort === "production_rating" ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
                {g.production_rating}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeasonJumpTable({ data }: { data: SeasonJumpLeaderboard }) {
  if (data.players.length === 0) return <p className="empty-state">No qualifying players.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>{data.season_from}</th>
            <th>{data.season_to}</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {data.players.map((p) => (
            <tr key={p.player_id}>
              <td>
                <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                <div className="label" style={{ marginTop: 2 }}>
                  {p.transferred ? `${p.from_team_name} → ${p.to_team_name}` : p.to_team_name}
                </div>
              </td>
              <td>{p.from_hoop_score.toFixed(1)}</td>
              <td>{p.to_hoop_score.toFixed(1)}</td>
              <td style={{ color: p.hoop_score_change >= 0 ? "var(--good)" : "var(--warn)", fontWeight: 700 }}>
                {p.hoop_score_change >= 0 ? "+" : ""}
                {p.hoop_score_change.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Reusable first-half -> second-half bar chart for the Back Half section --
// same visual language as ChartCard above (bar-row/bar-track/bar-fill), just
// driven by a change value plus first/second-half readouts instead of a
// single top-N stat value. Used once per metric (PPG/RPG/APG/TS%).
function BackHalfChangeChart({
  title, sub, players, getChange, getFirst, getSecond, unit,
}: {
  title: string;
  sub: string;
  players: BackHalfPlayer[];
  getChange: (p: BackHalfPlayer) => number;
  getFirst: (p: BackHalfPlayer) => number;
  getSecond: (p: BackHalfPlayer) => number;
  unit: string;
}) {
  if (players.length === 0) {
    return (
      <div className="chart-card">
        <h3>{title}</h3>
        <p className="empty-state" style={{ padding: "12px 0" }}>
          No qualifying players.
        </p>
      </div>
    );
  }
  const max = Math.max(...players.map((p) => Math.abs(getChange(p))), 0.0001);
  const top = players[0];
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      <div className="chart-sub">{sub}</div>
      {players.map((p) => {
        const change = getChange(p);
        return (
          <div className="bar-row" key={p.player_id}>
            <Link href={`/players/${p.player_id}`} className="bar-name" title={`${p.name} (${p.team_name})`}>
              {p.name}
            </Link>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${(Math.abs(change) / max) * 100}%`,
                  background: change < 0 ? "var(--text-dim)" : undefined,
                }}
              />
            </div>
            <div className="bar-value">
              {change > 0 ? "+" : ""}
              {change.toFixed(1)}
            </div>
          </div>
        );
      })}
      <p className="section-note" style={{ marginTop: 10 }}>
        1st half {getFirst(top).toFixed(1)} {unit} &rarr; 2nd half {getSecond(top).toFixed(1)} {unit} for the top
        mover on this list.
      </p>
    </div>
  );
}

function withLeaderboardPage(sp: SP, page: number): string {
  const p = new URLSearchParams();
  if (sp.stat) p.set("stat", sp.stat);
  if (sp.level) p.set("level", sp.level);
  if (sp.conference) p.set("conference", sp.conference);
  if (sp.class_year) p.set("class_year", sp.class_year);
  if (sp.position) p.set("position", sp.position);
  if (sp.min_games) p.set("min_games", sp.min_games);
  p.set("page", String(page));
  return p.toString();
}
