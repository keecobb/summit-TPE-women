import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamFits, TeamNeeds, TeamNeedCategory, TeamRoles, FitCandidate, DepartingPlayer } from "@/lib/types";
import { FIT_STATS, FIT_STAT_LABELS, ROLE_NAMES, roleLabel, TIERS, tierAbbrev } from "@/lib/types";
import Typeahead from "@/components/Typeahead";
import SortableTh from "@/components/SortableTh";
import FilterForm from "@/components/FilterForm";
import RoleStat from "@/components/RoleStat";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

const CLASS_YEARS = ["FR", "SO", "JR", "SR"];
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
  sort?: string;
  dir?: string;
  // "full" = this past season's actual roster (the old default, and
  // still useful for reference). Anything else (including unset) means
  // "returning roster" -- Seniors/Grads excluded, since they won't be on
  // next season's team. See the returning_only writeup below.
  view?: string;
}

// Confidence isn't a number in the API response -- rank it Low/Medium/High
// so clicking that column sorts meaningfully instead of alphabetically
// (which would read "High, Low, Medium").
const CONFIDENCE_RANK: Record<string, number> = { Low: 0, Medium: 1, High: 2 };

// Column key -> accessor into a fit candidate, for the client-side sort
// below. Client-side (not an API param) because /teams/{id}/fits already
// returns its whole ranked candidate pool in one call (limit 20) rather
// than paginating -- same reasoning as /teams' own sortable columns.
function fitsSortValue(c: FitCandidate & { fit_score: number }, column: string): string | number {
  switch (column) {
    case "name": return c.name;
    case "current_team": return c.current_team;
    case "level": return c.level;
    case "class_year": return c.class_year;
    case "games": return c.games;
    case "games_started": return c.games_started ?? -1;
    case "fit_score": return c.fit_score;
    case "hoop_score": return c.hoop_score;
    case "confidence": return CONFIDENCE_RANK[c.confidence] ?? -1;
    default: return "";
  }
}

// Rebuilds the current query string with the given overrides applied
// (undefined = drop that key) -- used by the returning/full-roster toggle
// so it preserves whatever filters the coach already has set (stat
// checkboxes, level, class, position, sort, etc.) instead of resetting
// the page.
function toggleQuery(sp: SP, overrides: Partial<SP>): string {
  const merged: Record<string, string | string[] | undefined> = { ...sp, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, value);
  }
  return params.toString();
}

export default async function TeamFitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<SP>;
}) {
  const { sport } = await params;
  const sp = await searchParams;
  if (!sp.team_id) return <TeamPickerView sp={sp} sport={sport} />;
  return <FitsView sp={sp} sport={sport} />;
}

async function TeamPickerView({ sp, sport }: { sp: SP; sport: string }) {
  return (
    <div>
      <h1>Team Fits</h1>
      <p className="subtitle">Pick your team, then tell us what you&apos;re looking for.</p>

      <div className="card card-prose" style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="team-fits-search">Find your team</label>
          <Typeahead
            sport={sport}
            kind="teams"
            inputId="team-fits-search"
            placeholder="e.g. Baylor"
            mode="navigate"
            hrefTemplate={`/${sport}/team-fits?team_id={id}`}
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

async function FitsView({ sp, sport }: { sp: SP; sport: string }) {
  const [team, roles] = await Promise.all([
    apiFetch<Team>(`/${sport}/teams/${sp.team_id}`),
    apiFetch<TeamRoles>(`/${sport}/teams/${sp.team_id}/roles`, { revalidate: 60 }),
  ]);
  // Needs is fetched separately (and tolerantly) since it can 404 for a
  // too-thin roster even when the team and its roles both load fine --
  // this section is a nice-to-have "here's why you're looking at this"
  // callout, not a hard dependency for the fits search itself.
  //
  // Default view is "returning roster" (returning_only=true): Seniors and
  // Grad students won't be back for 2026-27, so ranking needs off THIS
  // season's full roster overstates strength in categories a departing
  // class carried and understates it elsewhere. This is still just an
  // approximation off last season's game logs -- underclassmen who
  // transfer out, incoming transfers/signees, and redshirt/eligibility
  // changes aren't (and can't yet be) reflected, since next season's
  // roster isn't finalized. A "full roster" toggle (view=full) is kept
  // for reference against this past season's actual numbers.
  const returningOnly = sp.view !== "full";
  let needs: TeamNeeds | null = null;
  try {
    needs = await apiFetch<TeamNeeds>(`/${sport}/teams/${sp.team_id}/needs`, {
      params: { top_n: 3, level: team.tier, returning_only: returningOnly },
      revalidate: 60,
    });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  const selectedStats = Array.isArray(sp.stats) ? sp.stats : sp.stats ? [sp.stats] : [];

  let fits: TeamFits | null = null;
  let error: string | null = null;
  try {
    fits = await apiFetch<TeamFits>(`/${sport}/teams/${sp.team_id}/fits`, {
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

  // Comes back from the API already ranked by fit_score descending -- only
  // re-sort client-side when the coach has actually clicked a column,
  // so the default view is unchanged from before sortable columns existed.
  if (fits && sp.sort) {
    const dir = sp.dir === "asc" ? 1 : -1;
    fits.candidates = [...fits.candidates].sort((a, b) => {
      const av = fitsSortValue(a, sp.sort!), bv = fitsSortValue(b, sp.sort!);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
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
        <p className="section-note" style={{ marginTop: -4 }}>
          {returningOnly ? (
            <>
              Showing needs for the <strong>returning roster</strong> (Seniors/Grads removed) -- an approximation of
              2026-27, not a finalized roster.{" "}
              <Link href={`/${sport}/team-fits?${toggleQuery(sp, { view: "full" })}`}>
                View based on this past season&apos;s full roster instead
              </Link>
              .
            </>
          ) : (
            <>
              Showing needs based on <strong>this past season&apos;s full roster</strong>, including players who
              won&apos;t be back next season.{" "}
              <Link href={`/${sport}/team-fits?${toggleQuery(sp, { view: undefined })}`}>
                View based on the returning roster instead
              </Link>
              .
            </>
          )}
        </p>
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
                  <Link href={`/${sport}/team-fits?team_id=${sp.team_id}&stats=${w.stat}`}>{w.label}</Link>
                ) : (
                  w.label
                )}
              </span>
            ))}
            {" "}-- click one to search for players who&apos;d fill it. (Leaving the stat filter blank below does
            the same thing automatically, targeting the single biggest weakness.)
          </p>
        )}
        {needs && needs.returning_only && needs.returning_note && (
          <p className="section-note" style={{ marginTop: 8 }}>{needs.returning_note}</p>
        )}
        {needs && needs.returning_only && needs.departing_players && needs.departing_players.length > 0 && (
          <DepartingPlayersList players={needs.departing_players} />
        )}
      </div>

      <div className="card">
        <h2>Current Rotation</h2>
        <p className="section-note">
          Real minutes-based roles computed from {team.name}&apos;s own current roster -- what &quot;Starter&quot;
          or &quot;Role Player&quot; actually means here, before you pick one below in the Role to fill dropdown.
        </p>
        <div className="stat-grid">
          <RoleStat label={roleLabel("starter")} role={roles.starter} />
          <RoleStat label={roleLabel("sixth_man")} role={roles.sixth_man} />
          <RoleStat label={roleLabel("role_player")} role={roles.role_player} />
          <RoleStat label={roleLabel("depth_piece")} role={roles.depth_piece} />
        </div>
      </div>

      {needs && needs.full_profile.length > 0 && (
        <div className="card">
          <h2>
            Full Team Profile: Strengths &amp; Weaknesses
            <span
              className="hint"
              title={`Every tracked category vs. ${needs.comparison_group}, worst to best -- the same comparison Biggest Needs above pulls its top 3 from, just the whole picture instead of only the weak end.`}
            >
              ?
            </span>
          </h2>
          <p className="section-note">
            {needs.returning_only ? "Returning roster (Seniors/Grads excluded) " : "Full roster "}
            vs. {needs.comparison_group}. All {needs.full_profile.length} tracked categories, worst to best. Bars
            left of center (gold) are below-peer-average, right of center (green) are above -- hover a row for{" "}
            {team.name}&apos;s actual value alongside the peer and conference averages.
          </p>
          <TeamProfileBars profile={needs.full_profile} />
        </div>
      )}

      <div className="card">
        <FilterForm action={`/${sport}/team-fits`}>
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
        </FilterForm>
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
                  <SortableTh column="name" label="Player" defaultDir="asc" />
                  <SortableTh column="current_team" label="Current team" defaultDir="asc" />
                  <SortableTh column="level" label="Level" defaultDir="asc" />
                  <SortableTh column="class_year" label="Class" defaultDir="asc" />
                  <SortableTh column="games" label="GP" />
                  <SortableTh column="games_started" label="GS" />
                  <th>Projected</th>
                  <SortableTh column="hoop_score" label="Proj. Summit Score" />
                  <SortableTh column="fit_score" label="Fit Score" />
                  <SortableTh column="confidence" label="Confidence" />
                </tr>
              </thead>
              <tbody>
                {fits.candidates.map((c, i) => (
                  <tr key={c.player_id}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/${sport}/players/${c.player_id}`}>{c.name}</Link>
                    </td>
                    <td>{c.current_team}</td>
                    <td>
                      <span className="pill" title={c.level}>{tierAbbrev(c.level)}</span>
                    </td>
                    <td>{c.class_year}</td>
                    <td>{c.games}</td>
                    <td>{c.games_started ?? "--"}</td>
                    <td>
                      {Object.entries(c.projected)
                        .filter(([k]) => k !== "minutes")
                        .map(([k, v]) => `${k.replace("per40_", "")}: ${typeof v === "number" ? v.toFixed(1) : v}`)
                        .join(", ")}
                    </td>
                    <td>{c.hoop_score?.toFixed(1) ?? "--"}</td>
                    <td title="Average of standardized (z-score) values across every stat you searched on -- how this candidate ranks relative to the whole candidate pool, not a raw stat.">
                      {c.fit_score.toFixed(2)}
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
        <Link href={`/${sport}/team-fits`}>&larr; Choose a different team</Link>
      </p>
    </div>
  );
}

// Lists the Seniors/Grads whose production got pulled out of the
// returning-roster profile above -- lets a coach eyeball whether the
// "weakness" the tool is flagging is really a next-season gap or just
// this list of departing players walking out the door.
function DepartingPlayersList({ players }: { players: DepartingPlayer[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="section-note" style={{ marginBottom: 6 }}>
        Not returning ({players.length} Senior{players.length === 1 ? "" : "s"}/Grad{players.length === 1 ? "" : "s"}
        , this past season&apos;s production):
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {players.map((p) => (
          <span key={p.player_id} className="pill" title={`${p.position ?? ""} ${p.class_year ?? ""}`.trim()}>
            {p.name}
            {p.ppg != null && ` -- ${p.ppg.toFixed(1)} ppg`}
            {p.hoop_score != null && ` / ${p.hoop_score.toFixed(1)} score`}
          </span>
        ))}
      </div>
    </div>
  );
}

// Diverging (center-anchored) bar per category -- z is naturally
// positive-or-negative around 0, so unlike the site's usual left-anchored
// .bar-fill (see ProjectionCompareChart in app/tpe/page.tsx), each row's
// fill grows from the middle toward whichever side the number actually
// falls on. Clamped at |z|=3 for the bar's width scale only (a category
// that's +5z still just draws as "all the way right") -- the exact z value
// is always shown as text regardless, so nothing is hidden, just the bar
// itself doesn't get proportionally more full past a fairly extreme point.
const PROFILE_BAR_CLAMP = 3;

function TeamProfileBars({ profile }: { profile: TeamNeedCategory[] }) {
  return (
    <div>
      {profile.map((c) => {
        const clamped = Math.max(-PROFILE_BAR_CLAMP, Math.min(PROFILE_BAR_CLAMP, c.z));
        const pct = (Math.abs(clamped) / PROFILE_BAR_CLAMP) * 50;
        const positive = c.z >= 0;
        // team_value/league_mean/conference_mean already arrive pre-scaled
        // from the API (ts_pct/fg_pct are *100'd server-side, see
        // team_needs() in projection.py) -- one decimal reads fine uniformly.
        const tooltip =
          `${c.label}: ${c.team_value.toFixed(1)} (this team) vs. ${c.league_mean.toFixed(1)} (peer average)` +
          (c.conference_mean != null ? `, ${c.conference_mean.toFixed(1)} (conference average)` : "") +
          ` -- ${c.z >= 0 ? "+" : ""}${c.z.toFixed(2)}z`;
        return (
          <div key={c.stat} className="bar-row" style={{ gridTemplateColumns: "128px 1fr 52px" }} title={tooltip}>
            <div className="bar-name">{c.label}</div>
            <div className="diverge-track">
              <div className="diverge-center" />
              <div
                className="diverge-fill"
                style={{
                  left: positive ? "50%" : `${50 - pct}%`,
                  width: `${pct}%`,
                  background: positive ? "var(--good)" : "var(--warn)",
                }}
              />
            </div>
            <div className="bar-value" style={{ color: positive ? "var(--good)" : "var(--warn)" }}>
              {c.z >= 0 ? "+" : ""}
              {c.z.toFixed(2)}z
            </div>
          </div>
        );
      })}
    </div>
  );
}
