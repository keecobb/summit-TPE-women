import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { PlayerDetail, Team, TeamNeeds, TeamRoles } from "@/lib/types";
import { tierAbbrev } from "@/lib/types";
import Typeahead from "@/components/Typeahead";
import FilterForm from "@/components/FilterForm";
import FlowSteps from "@/components/FlowSteps";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

interface SP {
  mode?: string;
  player1?: string;
  player2?: string;
  team1?: string;
  team2?: string;
}

// Stat rows shown in the comparison table -- [key on PlayerDetail, label,
// display formatter]. ts_pct/fg_pct come back as raw 0-1 fractions on
// /players/{id} (unlike the list endpoint), so those two get *100 here.
const ROWS: { key: keyof PlayerDetail; label: string; fmt?: (v: number) => string }[] = [
  { key: "games", label: "GP", fmt: (v) => v.toFixed(0) },
  { key: "avg_minutes", label: "MPG" },
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "topg", label: "TOPG" },
  { key: "ts_pct", label: "TS%", fmt: (v) => (v * 100).toFixed(1) },
  { key: "fg_pct", label: "FG%", fmt: (v) => (v * 100).toFixed(1) },
  { key: "per40_pts", label: "Pts/40" },
  { key: "per40_reb", label: "Reb/40" },
  { key: "per40_ast", label: "Ast/40" },
  { key: "hoop_score", label: "Summit Score" },
];

// Fixed display order for the team full-stats-profile categories -- each
// team's own /teams/{id}/needs response sorts its full_profile by that
// team's OWN z-score (weakest-first), so two teams' lists aren't in the
// same order as each other. Re-indexing by stat key and walking this fixed
// order keeps both columns aligned on the same category per row.
const TEAM_STAT_ORDER = [
  "per40_pts", "per40_reb", "per40_ast", "per40_blk", "per40_stl", "per40_tov", "ts_pct", "fg_pct",
];
const TEAM_STAT_LOWER_IS_BETTER = new Set(["per40_tov"]);
const TEAM_STAT_IS_PCT = new Set(["ts_pct", "fg_pct"]);

function ModeTabs({ mode, sport }: { mode: "players" | "teams"; sport: string }) {
  return (
    <div className="tabs" style={{ marginBottom: 20 }}>
      <Link href={`/${sport}/compare`} className={`tab${mode === "players" ? " active" : ""}`}>
        Players
      </Link>
      <Link href={`/${sport}/compare?mode=teams`} className={`tab${mode === "teams" ? " active" : ""}`}>
        Teams
      </Link>
    </div>
  );
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<SP>;
}) {
  const { sport } = await params;
  const sp = await searchParams;
  const mode: "players" | "teams" = sp.mode === "teams" ? "teams" : "players";

  if (mode === "teams") {
    if (!sp.team1 || !sp.team2) return <TeamPickerView sp={sp} sport={sport} />;
    return <TeamResultView sp={sp} sport={sport} />;
  }

  if (!sp.player1 || !sp.player2) {
    return <PickerView sp={sp} sport={sport} />;
  }

  let p1: PlayerDetail, p2: PlayerDetail;
  try {
    [p1, p2] = await Promise.all([
      apiFetch<PlayerDetail>(`/${sport}/players/${sp.player1}`, { revalidate: 60 }),
      apiFetch<PlayerDetail>(`/${sport}/players/${sp.player2}`, { revalidate: 60 }),
    ]);
  } catch (e) {
    if (e instanceof ApiError) {
      return (
        <div>
          <h1>Compare Players</h1>
          <ModeTabs mode="players" sport={sport} />
          <div className="error-box">{e.message}</div>
          <p style={{ marginTop: 20 }}>
            <Link href={`/${sport}/compare`}>&larr; Start over</Link>
          </p>
        </div>
      );
    }
    throw e;
  }

  return (
    <div>
      <h1>Compare Players</h1>
      <ModeTabs mode="players" sport={sport} />
      <p className="subtitle">
        {p1.season} season, per-game unless noted. Higher is bolded for every row (lower is better for TOPG, not
        bolded specially -- read that one the other way).
      </p>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Stat</th>
                <th>
                  <Link href={`/${sport}/players/${p1.player_id}`}>{p1.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {p1.team_name} &middot; {tierAbbrev(p1.team_tier ?? p1.tier)} &middot; {p1.position}, {p1.class_year}
                    {p1.thin_sample ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>limited</span> : null}
                  </div>
                </th>
                <th>
                  <Link href={`/${sport}/players/${p2.player_id}`}>{p2.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {p2.team_name} &middot; {tierAbbrev(p2.team_tier ?? p2.tier)} &middot; {p2.position}, {p2.class_year}
                    {p2.thin_sample ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>limited</span> : null}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const v1 = p1[r.key] as number | null | undefined;
                const v2 = p2[r.key] as number | null | undefined;
                const lowerBetter = r.key === "topg";
                const better1 = v1 != null && v2 != null && (lowerBetter ? v1 < v2 : v1 > v2);
                const better2 = v1 != null && v2 != null && (lowerBetter ? v2 < v1 : v2 > v1);
                const fmt = r.fmt ?? ((v: number) => v.toFixed(1));
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td style={better1 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v1 != null ? fmt(v1) : "--"}
                    </td>
                    <td style={better2 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v2 != null ? fmt(v2) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link href={`/${sport}/compare`}>&larr; Compare different players</Link>
      </p>
    </div>
  );
}

async function PickerView({ sp, sport }: { sp: SP; sport: string }) {
  let player1: PlayerDetail | null = null;
  if (sp.player1) {
    try {
      player1 = await apiFetch<PlayerDetail>(`/${sport}/players/${sp.player1}`, { revalidate: 60 });
    } catch {
      // ignore -- fall through to letting them pick again
    }
  }

  return (
    <div>
      <h1>Compare Players</h1>
      <ModeTabs mode="players" sport={sport} />
      <p className="subtitle">Pick two players to see their current-season stats side by side.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Search by name for each player, pick from the dropdown, then submit -- every row is real production
        this season, with the better value in each row bolded (lower is better for TOPG only, read that row
        the other way around).
      </p>

      <FlowSteps steps={["Pick Player 1", "Pick Player 2", "See them side by side"]} />

      <div className="card card-prose" style={{ maxWidth: 480 }}>
        <FilterForm action={`/${sport}/compare`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label htmlFor="player1-search">Player 1</label>
            <Typeahead
              sport={sport}
              kind="players"
              inputId="player1-search"
              placeholder="e.g. Bruna Anguera"
              mode="select"
              hiddenName="player1"
              required
              defaultSelectedId={player1?.player_id}
              defaultSelectedLabel={player1?.name}
            />
          </div>
          <div className="field">
            <label htmlFor="player2-search">Player 2</label>
            <Typeahead
              sport={sport}
              kind="players"
              inputId="player2-search"
              placeholder="e.g. Audi Crooks"
              mode="select"
              hiddenName="player2"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 4 }}>
            Compare
          </button>
        </FilterForm>
      </div>
    </div>
  );
}

async function TeamResultView({ sp, sport }: { sp: SP; sport: string }) {
  let t1: Team, t2: Team, needs1: TeamNeeds, needs2: TeamNeeds, roles1: TeamRoles, roles2: TeamRoles;
  try {
    [t1, t2, needs1, needs2, roles1, roles2] = await Promise.all([
      apiFetch<Team>(`/${sport}/teams/${sp.team1}`, { revalidate: 60 }),
      apiFetch<Team>(`/${sport}/teams/${sp.team2}`, { revalidate: 60 }),
      apiFetch<TeamNeeds>(`/${sport}/teams/${sp.team1}/needs`, { params: { top_n: 8 }, revalidate: 60 }),
      apiFetch<TeamNeeds>(`/${sport}/teams/${sp.team2}/needs`, { params: { top_n: 8 }, revalidate: 60 }),
      apiFetch<TeamRoles>(`/${sport}/teams/${sp.team1}/roles`, { revalidate: 60 }),
      apiFetch<TeamRoles>(`/${sport}/teams/${sp.team2}/roles`, { revalidate: 60 }),
    ]);
  } catch (e) {
    if (e instanceof ApiError) {
      return (
        <div>
          <h1>Compare Teams</h1>
          <ModeTabs mode="teams" sport={sport} />
          <div className="error-box">{e.message}</div>
          <p style={{ marginTop: 20 }}>
            <Link href={`/${sport}/compare?mode=teams`}>&larr; Start over</Link>
          </p>
        </div>
      );
    }
    throw e;
  }

  const cats1 = Object.fromEntries(needs1.full_profile.map((c) => [c.stat, c]));
  const cats2 = Object.fromEntries(needs2.full_profile.map((c) => [c.stat, c]));

  return (
    <div>
      <h1>Compare Teams</h1>
      <ModeTabs mode="teams" sport={sport} />
      <p className="subtitle">
        Current season, real team averages unless noted. Higher is bolded for every stat row (lower is better
        for Turnovers, not bolded specially -- read that one the other way).
      </p>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Stat</th>
                <th>
                  <Link href={`/${sport}/teams/${t1.team_id}`}>{t1.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {t1.conference} &middot; {tierAbbrev(t1.tier)}
                  </div>
                </th>
                <th>
                  <Link href={`/${sport}/teams/${t2.team_id}`}>{t2.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {t2.conference} &middot; {tierAbbrev(t2.tier)}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Rating
                  <span className="hint" title="Overall team strength on one shared scale -- higher is stronger, roughly centered on 0 across all of Division I.">
                    ?
                  </span>
                </td>
                <td style={t1.current_rating > t2.current_rating ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                  {t1.current_rating.toFixed(2)}
                </td>
                <td style={t2.current_rating > t1.current_rating ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                  {t2.current_rating.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td>
                  SOS
                  <span className="hint" title="Strength of schedule -- the average Rating of this team's opponents this season.">
                    ?
                  </span>
                </td>
                <td>{t1.sos?.toFixed(2) ?? "--"}</td>
                <td>{t2.sos?.toFixed(2) ?? "--"}</td>
              </tr>
              <tr>
                <td>
                  Roster Avg Summit Score
                  <span className="hint" title="The average Summit Score across every player on the roster with a real (non-limited-sample) profile -- a quick read on overall roster quality/depth, not just the best player or the team's own Rating.">
                    ?
                  </span>
                </td>
                <td style={
                  roles1.roster_avg_summit_score != null && roles2.roster_avg_summit_score != null &&
                  roles1.roster_avg_summit_score > roles2.roster_avg_summit_score
                    ? { fontWeight: 700, color: "var(--accent)" } : undefined
                }>
                  {roles1.roster_avg_summit_score?.toFixed(1) ?? "--"}
                </td>
                <td style={
                  roles1.roster_avg_summit_score != null && roles2.roster_avg_summit_score != null &&
                  roles2.roster_avg_summit_score > roles1.roster_avg_summit_score
                    ? { fontWeight: 700, color: "var(--accent)" } : undefined
                }>
                  {roles2.roster_avg_summit_score?.toFixed(1) ?? "--"}
                </td>
              </tr>
              {TEAM_STAT_ORDER.map((stat) => {
                const c1 = cats1[stat];
                const c2 = cats2[stat];
                if (!c1 && !c2) return null;
                const label = (c1 ?? c2).label;
                const v1 = c1?.team_value;
                const v2 = c2?.team_value;
                const lowerBetter = TEAM_STAT_LOWER_IS_BETTER.has(stat);
                const better1 = v1 != null && v2 != null && (lowerBetter ? v1 < v2 : v1 > v2);
                const better2 = v1 != null && v2 != null && (lowerBetter ? v2 < v1 : v2 > v1);
                const suffix = TEAM_STAT_IS_PCT.has(stat) ? "%" : "";
                return (
                  <tr key={stat}>
                    <td style={{ textTransform: "capitalize" }}>{label}</td>
                    <td style={better1 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v1 != null ? `${v1.toFixed(1)}${suffix}` : "--"}
                    </td>
                    <td style={better2 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v2 != null ? `${v2.toFixed(1)}${suffix}` : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link href={`/${sport}/compare?mode=teams`}>&larr; Compare different teams</Link>
      </p>
    </div>
  );
}

async function TeamPickerView({ sp, sport }: { sp: SP; sport: string }) {
  let team1: Team | null = null;
  if (sp.team1) {
    try {
      team1 = await apiFetch<Team>(`/${sport}/teams/${sp.team1}`, { revalidate: 60 });
    } catch {
      // ignore -- fall through to letting them pick again
    }
  }

  return (
    <div>
      <h1>Compare Teams</h1>
      <ModeTabs mode="teams" sport={sport} />
      <p className="subtitle">Pick two teams to see their ratings and real season averages side by side.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Search by name for each team, pick from the dropdown, then submit -- Rating, SOS, and every team-average
        stat category are compared, with the better value in each row bolded (lower is better for Turnovers
        only, read that row the other way around).
      </p>

      <FlowSteps steps={["Pick Team 1", "Pick Team 2", "See them side by side"]} />

      <div className="card card-prose" style={{ maxWidth: 480 }}>
        <FilterForm action={`/${sport}/compare`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="hidden" name="mode" value="teams" />
          <div className="field">
            <label htmlFor="team1-search">Team 1</label>
            <Typeahead
              sport={sport}
              kind="teams"
              inputId="team1-search"
              placeholder="e.g. South Carolina"
              mode="select"
              hiddenName="team1"
              required
              defaultSelectedId={team1?.team_id}
              defaultSelectedLabel={team1?.name}
            />
          </div>
          <div className="field">
            <label htmlFor="team2-search">Team 2</label>
            <Typeahead
              sport={sport}
              kind="teams"
              inputId="team2-search"
              placeholder="e.g. UCLA"
              mode="select"
              hiddenName="team2"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 4 }}>
            Compare
          </button>
        </FilterForm>
      </div>
    </div>
  );
}
