import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamRoles, TeamNeeds, Player, TeamSchedule, LeapCandidates } from "@/lib/types";
import { ROLE_NAMES, roleLabel } from "@/lib/types";
import { titleCase } from "@/lib/format";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "roster", label: "Roster" },
  { key: "schedule", label: "Schedule" },
  { key: "stats", label: "Stats Breakdown" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; leap_role?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  let team: Team;
  try {
    team = await apiFetch<Team>(`/teams/${id}`, { revalidate: 60 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div>
      <h1>{team.name}</h1>
      <p className="subtitle">
        <Link href={`/conferences/${encodeURIComponent(team.conference)}`}>{team.conference}</Link> &middot;{" "}
        <span className="pill">{team.tier}</span>
      </p>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 20, maxWidth: "68ch" }}>
        Overview covers this team&apos;s rating, its real minutes-based rotation roles, its biggest statistical
        needs vs. its peers, and who&apos;d make the biggest Summit Score leap by transferring in. Roster,
        Schedule, and Stats Breakdown are full detail tabs below.
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/teams/${id}?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab id={id} team={team} leapRole={sp.leap_role} />}
      {tab === "roster" && <RosterTab id={id} />}
      {tab === "schedule" && <ScheduleTab id={id} />}
      {tab === "stats" && <StatsTab id={id} team={team} />}
    </div>
  );
}

async function OverviewTab({ id, team, leapRole }: { id: string; team: Team; leapRole?: string }) {
  const resolvedLeapRole = ROLE_NAMES.includes(leapRole as (typeof ROLE_NAMES)[number]) ? (leapRole as string) : "starter";

  const [roles, needs, leap] = await Promise.all([
    apiFetch<TeamRoles>(`/teams/${id}/roles`, { revalidate: 60 }),
    apiFetch<TeamNeeds>(`/teams/${id}/needs`, { params: { top_n: 3 }, revalidate: 60 }),
    // Best Transfer Fits (ranked by raw projected stat value) is hidden for
    // now -- it tends to surface the same handful of already-elite names
    // regardless of team, which isn't a very useful "fit" read. This
    // leap-by-role section replaces it: same underlying projection math,
    // but ranked by the JUMP in Summit Score a transfer would represent,
    // and it's not real-time cached (revalidate omitted) since it
    // intentionally samples a different mix of names on each load.
    apiFetch<LeapCandidates>(`/teams/${id}/leap-candidates`, { params: { role: resolvedLeapRole, limit: 8 }, revalidate: 0 }),
  ]);

  return (
    <div>
      <div className="stat-grid" style={{ maxWidth: 400 }}>
        <Stat
          label="Rating"
          value={team.current_rating}
          highlight
          hint="This team's overall strength on one shared scale, computed from this season's real results. Higher is stronger; roughly centered on 0 across all of Division I, so a positive number is above average and a negative number is below."
        />
        <Stat
          label="SOS"
          value={team.sos}
          hint="Strength of schedule -- the average Rating of this team's opponents this season. Higher means a tougher schedule."
        />
        <Stat
          label="Roster"
          value={roles.roster_size}
          hint="Number of players on this team's current-season roster with enough recorded games/minutes to be included in the site's stats."
        />
      </div>

      <div className="card">
        <h2>Rotation Minutes (This Roster)</h2>
        <p className="section-note">
          Real minutes-based roles computed from this team&apos;s own current roster -- what &quot;Starter&quot; or
          &quot;Sixth Man&quot; actually means here.
        </p>
        <div className="stat-grid">
          <RoleStat label={roleLabel("starter")} role={roles.starter} />
          <RoleStat label={roleLabel("sixth_man")} role={roles.sixth_man} />
          <RoleStat label={roleLabel("role_player")} role={roles.role_player} />
          <RoleStat label={roleLabel("depth_piece")} role={roles.depth_piece} />
        </div>
      </div>

      <div className="card">
        <h2>Biggest Needs</h2>
        <p className="section-note">
          Weakest categories vs. {needs.comparison_group}
          {needs.conference ? ` -- ${needs.conference} average shown alongside for a closer reference point` : ""}.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Team Average</th>
                <th>{needs.conference ?? "Conf."} Avg</th>
                <th>League Avg</th>
                <th>
                  Z-score
                  <ZScoreHint />
                </th>
              </tr>
            </thead>
            <tbody>
              {needs.weaknesses.map((w) => (
                <tr key={w.stat}>
                  <td>{titleCase(w.label)}</td>
                  <td>{w.team_value?.toFixed(1)}</td>
                  <td>{w.conference_mean != null ? w.conference_mean.toFixed(1) : "--"}</td>
                  <td>{w.league_mean?.toFixed(1)}</td>
                  <td>
                    <span className="pill pill-warn">{w.z?.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>
          Biggest Summit Score Leap by Role
          <span className="hint" title="Ranked by the jump between each candidate's CURRENT Summit Score and her PROJECTED Summit Score if she transferred here in the selected role -- not by raw projected value, so this surfaces the biggest statistical step-ups rather than just whoever's already elite. That jump is driven by the team-strength gap and doesn't change by role; the role you pick controls the projected minutes/stat line shown for each candidate, and which names get sampled into the list.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Pick a role to see who outside this roster would gain the most by transferring in and playing it.
          Sampled from a wider pool of high-leap candidates, so reloading this section (or switching roles) can
          surface a different mix of names rather than a frozen list.
        </p>
        <div className="hero-actions" style={{ marginTop: 4, marginBottom: 16 }}>
          {ROLE_NAMES.map((r) => (
            <Link
              key={r}
              href={`/teams/${id}?tab=overview&leap_role=${r}`}
              className={`btn${resolvedLeapRole === r ? " btn-primary" : ""}`}
            >
              {roleLabel(r)}
            </Link>
          ))}
        </div>
        {leap.candidates.length > 0 && leap.candidates[0].hoop_score_delta <= 0 && (
          <p className="section-note" style={{ marginBottom: 12 }}>
            Every candidate here shows a flat or negative leap -- that&apos;s expected for a team this strong:
            the model&apos;s leap is driven by the team-strength gap, and there&apos;s little room to climb by
            joining a team that&apos;s already at or near the top. Shown ranked smallest-drop-off-first instead.
          </p>
        )}
        {leap.candidates.length === 0 ? (
          <p className="empty-state">No qualifying candidates.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Current Team</th>
                  <th>Level</th>
                  <th>Current</th>
                  <th>Projected</th>
                  <th>Leap</th>
                  <th>Proj. Min</th>
                </tr>
              </thead>
              <tbody>
                {leap.candidates.map((c) => (
                  <tr key={c.player_id}>
                    <td>
                      <Link href={`/players/${c.player_id}`}>{c.name}</Link>
                    </td>
                    <td>{c.current_team}</td>
                    <td>
                      <span className="pill">{c.level}</span>
                    </td>
                    <td>{c.current_hoop_score.toFixed(1)}</td>
                    <td>{c.projected_hoop_score.toFixed(1)}</td>
                    <td style={{ color: "var(--accent)", fontWeight: 700 }}>
                      {c.hoop_score_delta > 0 ? "+" : ""}
                      {c.hoop_score_delta.toFixed(1)}
                    </td>
                    <td>{c.projected_minutes.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="section-note" style={{ marginTop: 10 }}>
          {leap.role_applied ? `Assuming ${roleLabel(leap.role_applied.role)} minutes (${leap.role_applied.minutes.toFixed(1)}/game) at ${team.name}.` : ""}{" "}
          {leap.candidates_considered} candidates considered.
        </p>
      </div>
    </div>
  );
}

async function RosterTab({ id }: { id: string }) {
  const roster = await apiFetch<Player[]>("/players", { params: { team_id: id, limit: 50 } });

  if (roster.length === 0) return <p className="empty-state">No players on record for this team.</p>;

  return (
    <div className="card">
      <h2>Roster</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Height</th>
              <th>Class</th>
              <th>PPG</th>
              <th>RPG</th>
              <th>APG</th>
              <th>Summit Score</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.player_id}>
                <td>
                  <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                </td>
                <td>{p.position}</td>
                <td>{p.height ?? "--"}</td>
                <td>{p.class_year}</td>
                <td>{p.ppg?.toFixed(1)}</td>
                <td>{p.rpg?.toFixed(1)}</td>
                <td>{p.apg?.toFixed(1)}</td>
                <td>{p.hoop_score?.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function ScheduleTab({ id }: { id: string }) {
  const schedule = await apiFetch<TeamSchedule>(`/teams/${id}/schedule`, { params: { season: "2025-26" }, revalidate: 60 });

  if (schedule.games.length === 0) {
    return <p className="empty-state">No games on record for this team.</p>;
  }

  return (
    <div className="card">
      <h2>Schedule</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Result</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {schedule.games.map((g) => (
              <tr key={g.game_id}>
                <td>
                  <Link href={`/games/${g.game_id}`}>{formatGameDate(g.date)}</Link>
                </td>
                <td>
                  {g.is_home ? "vs " : "@ "}
                  {g.opponent_name}
                  {g.neutral_site ? <span className="pill" style={{ marginLeft: 6 }}>Neutral</span> : null}
                </td>
                <td>
                  {g.won == null ? (
                    <span className="pill">--</span>
                  ) : (
                    <span className={g.won ? "pill pill-good" : "pill pill-warn"}>{g.won ? "W" : "L"}</span>
                  )}
                </td>
                <td>
                  {g.team_score ?? "--"}-{g.opponent_score ?? "--"}
                  {g.overtime ? " (OT)" : ""}
                </td>
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function StatsTab({ id, team }: { id: string; team: Team }) {
  // top_n only controls how many are called out as "weaknesses" -- full_profile
  // always includes every tracked category regardless, so this just needs to be
  // a valid value (the API caps it at the total category count, currently 8).
  const needs = await apiFetch<TeamNeeds>(`/teams/${id}/needs`, { params: { top_n: 8 }, revalidate: 60 });

  return (
    <div className="card">
      <h2>Full Stats Breakdown</h2>
      <p className="section-note">
        Every category vs. {needs.comparison_group}
        {needs.conference ? ` and vs. the ${needs.conference} (${needs.teams_in_conference} teams)` : ""}.{" "}
        {team.name} rating: {team.current_rating.toFixed(2)} &middot; SOS: {team.sos?.toFixed(2)}.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Team</th>
              <th>{needs.conference ?? "Conf."} Avg</th>
              <th>League Avg</th>
              <th>
                Z-score
                <ZScoreHint />
              </th>
            </tr>
          </thead>
          <tbody>
            {needs.full_profile.map((w) => (
              <tr key={w.stat}>
                <td>{titleCase(w.label)}</td>
                <td>{w.team_value?.toFixed(1)}</td>
                <td>{w.conference_mean != null ? w.conference_mean.toFixed(1) : "--"}</td>
                <td>{w.league_mean?.toFixed(1)}</td>
                <td>
                  <span className={w.z < 0 ? "pill pill-warn" : "pill pill-good"}>{w.z?.toFixed(2)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ZScoreHint() {
  return (
    <span
      className="hint"
      title="How many standard deviations above or below the peer average this team is in that category. 0 means exactly average; +1.0 is solidly better than most peers; -1.0 is a real weakness relative to peers. It's not a percentage -- it's a measure of how unusual the team's number is compared to its peer group."
    >
      ?
    </span>
  );
}

function Stat({
  label, value, highlight, hint,
}: {
  label: string;
  value: unknown;
  highlight?: boolean;
  hint?: string;
}) {
  const num =
    typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : String(value ?? "--");
  return (
    <div className="stat-tile">
      <div className="value" style={highlight ? { color: "var(--accent)" } : undefined}>
        {num}
      </div>
      <div className="label">
        {label}
        {hint ? (
          <span className="hint" title={hint}>
            ?
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RoleStat({ label, role }: { label: string; role: { minutes: number } | null }) {
  return (
    <div className="stat-tile">
      <div className="value">{role ? `${role.minutes.toFixed(1)}` : "--"}</div>
      <div className="label">
        {label}
        {role ? " min" : ""}
      </div>
    </div>
  );
}
