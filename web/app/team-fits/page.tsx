import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamFits, TeamNeeds, TeamRoles } from "@/lib/types";
import { FIT_STATS, FIT_STAT_LABELS, ROLE_NAMES, roleLabel, TIERS, tierAbbrev } from "@/lib/types";
import Typeahead from "@/components/Typeahead";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

const CLASS_YEARS = ["FR", "SO", "JR", "SR", "GR"];
const POSITIONS = ["G", "F", "C"];

interface SP {
  team_id?: string;
  team_search?: string;
  stats?: string | string[];
  min_games?: string;
  level?: string;
  role?: string;
  minutes?: string;
  class_year?: string;
  position?: string;
}

export default async function TeamFitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!sp.team_id) return <TeamPickerView sp={sp} />;
  return <FitsView sp={sp} />;
}

async function TeamPickerView({ sp }: { sp: SP }) {
  return (
    <div>
      <h1>Team Fits</h1>
      <p className="subtitle">Pick your team, then tell us what you&apos;re looking for.</p>

      <div className="card card-prose" style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="team-fits-search">Find your team</label>
          <Typeahead
            kind="teams"
            inputId="team-fits-search"
            placeholder="e.g. Baylor"
            mode="navigate"
            hrefTemplate="/team-fits?team_id={id}"
            defaultValue={sp.team_search}
          />
        </div>
        <p className="section-note" style={{ marginTop: 10, marginBottom: 0 }}>
          Start typing a school and pick from the list.
        </p>
      </div>
    </div>
  );
}

async function FitsView({ sp }: { sp: SP }) {
  const [team, roles] = await Promise.all([
    apiFetch<Team>(`/teams/${sp.team_id}`),
    apiFetch<TeamRoles>(`/teams/${sp.team_id}/roles`, { revalidate: 60 }),
  ]);
  // Needs is fetched separately (and tolerantly) since it can 404 for a
  // too-thin roster even when the team and its roles both load fine --
  // this section is a nice-to-have "here's why you're looking at this"
  // callout, not a hard dependency for the fits search itself.
  let needs: TeamNeeds | null = null;
  try {
    needs = await apiFetch<TeamNeeds>(`/teams/${sp.team_id}/needs`, { params: { top_n: 3, level: team.tier }, revalidate: 60 });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  const selectedStats = Array.isArray(sp.stats) ? sp.stats : sp.stats ? [sp.stats] : [];

  let fits: TeamFits | null = null;
  let error: string | null = null;
  try {
    fits = await apiFetch<TeamFits>(`/teams/${sp.team_id}/fits`, {
      params: {
        stats: selectedStats.length > 0 ? selectedStats : undefined,
        min_games: sp.min_games ?? 5,
        level: sp.level,
        role: sp.minutes ? undefined : sp.role,
        minutes: sp.minutes,
        class_year: sp.class_year,
        position: sp.position,
        limit: 20,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) error = e.message;
    else throw e;
  }

  return (
    <div>
      <h1>{team.name}: Team Fits</h1>
      <p className="subtitle">Top 20 players who&apos;d project best into what you&apos;re looking for.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Pick a stat category (or leave it blank to auto-target this team&apos;s biggest statistical weakness),
        then narrow by level, class, position, or a role/minutes assumption. Every candidate is projected with
        the same math as Transfer Projection -- this just runs it over the whole player pool at once and ranks
        the results.
      </p>

      <div className="card">
        <h2>{team.name} Snapshot</h2>
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="value">{team.current_rating.toFixed(1)}</div>
            <div className="label">Current Rating ({team.tier})</div>
          </div>
          <div className="stat-tile">
            <div className="value">{roles.roster_avg_summit_score?.toFixed(1) ?? "--"}</div>
            <div className="label">Roster Avg Summit Score</div>
          </div>
          {needs && needs.weaknesses.slice(0, 2).map((w) => (
            <div className="stat-tile" key={w.stat}>
              <div className="value" style={{ color: "var(--warn)" }}>{w.z.toFixed(2)}z</div>
              <div className="label">Weakest: {w.label}</div>
            </div>
          ))}
        </div>
        {needs && needs.weaknesses.length > 0 && (
          <p className="section-note" style={{ marginTop: 12 }}>
            Biggest needs vs. {team.tier} peers, worst first:{" "}
            {needs.weaknesses.map((w, i) => (
              <span key={w.stat}>
                {i > 0 && ", "}
                {FIT_STATS.includes(w.stat as (typeof FIT_STATS)[number]) ? (
                  <Link href={`/team-fits?team_id=${sp.team_id}&stats=${w.stat}`}>{w.label}</Link>
                ) : (
                  w.label
                )}
              </span>
            ))}
            {" "}-- click one to search for players who&apos;d fill it. (Leaving the stat filter blank below does
            the same thing automatically, targeting the single biggest weakness.)
          </p>
        )}
      </div>

      <div className="card">
        <form action="/team-fits">
          <input type="hidden" name="team_id" value={sp.team_id} />

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.78rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Stat(s) you need -- leave blank to auto-pick this team&apos;s biggest weakness
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              {FIT_STATS.map((s) => (
                <label key={s} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", minWidth: "auto" }}>
                  <input type="checkbox" name="stats" value={s} defaultChecked={selectedStats.includes(s)} style={{ minWidth: "auto", width: 16 }} />
                  {FIT_STAT_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-form" style={{ marginBottom: 0 }}>
            <div className="field">
              <label htmlFor="level">Level</label>
              <select id="level" name="level" defaultValue={sp.level ?? ""}>
                <option value="">Any</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t} ({tierAbbrev(t)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="class_year">Class</label>
              <select id="class_year" name="class_year" defaultValue={sp.class_year ?? ""}>
                <option value="">Any</option>
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
                <option value="">Any</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="min_games">Min. games played</label>
              <input id="min_games" name="min_games" type="number" min={0} defaultValue={sp.min_games ?? "5"} />
            </div>
            <div className="field">
              <label htmlFor="role">Role to fill</label>
              <select id="role" name="role" defaultValue={sp.role ?? ""}>
                <option value="">Each candidate&apos;s own auto minutes</option>
                {ROLE_NAMES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="minutes">...or exact minutes</label>
              <input id="minutes" name="minutes" type="number" min={0} max={40} step={0.5} defaultValue={sp.minutes ?? ""} />
            </div>
            <button className="btn btn-primary" type="submit">
              Search
            </button>
          </div>
        </form>
      </div>

      {error && <div className="error-box">{error}</div>}

      {fits && (
        <>
          <p className="section-note">
            Ranking on:{" "}
            <strong>{fits.stats.map((s) => s.label).join(" + ")}</strong>
            {fits.role_applied && ` -- assuming ${roleLabel(fits.role_applied.role)} minutes (${fits.role_applied.minutes.toFixed(1)}/game)`}
            {fits.minutes_applied != null && ` -- assuming ${fits.minutes_applied} minutes/game`} &middot;{" "}
            {fits.candidates_considered} candidates considered.
          </p>

          {fits.candidates.length === 0 ? (
            <p className="empty-state">No candidates matched those filters.</p>
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Current team</th>
                  <th>Level</th>
                  <th>Class</th>
                  <th>Projected</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {fits.candidates.map((c, i) => (
                  <tr key={c.player_id}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/players/${c.player_id}`}>{c.name}</Link>
                    </td>
                    <td>{c.current_team}</td>
                    <td>
                      <span className="pill" title={c.level}>{tierAbbrev(c.level)}</span>
                    </td>
                    <td>{c.class_year}</td>
                    <td>
                      {Object.entries(c.projected)
                        .filter(([k]) => k !== "minutes")
                        .map(([k, v]) => `${k.replace("per40_", "")}: ${typeof v === "number" ? v.toFixed(1) : v}`)
                        .join(", ")}
                    </td>
                    <td>
                      <span className={c.extreme_mismatch ? "pill pill-warn" : "pill pill-good"}>{c.confidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/team-fits">&larr; Choose a different team</Link>
      </p>
    </div>
  );
}
