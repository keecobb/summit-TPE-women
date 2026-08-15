import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamRoles, TeamNeeds, TeamNeedCategory, Player, TeamSchedule } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import { titleCase } from "@/lib/format";
import RoleStat from "@/components/RoleStat";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ tab?: string }>;
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
        Overview covers this team&apos;s rating, its real minutes-based rotation roles, and its statistical
        profile vs. its peers. Roster, Schedule, and Stats Breakdown are full detail tabs below.
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/teams/${id}?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab id={id} team={team} />}
      {tab === "roster" && <RosterTab id={id} />}
      {tab === "schedule" && <ScheduleTab id={id} />}
      {tab === "stats" && <StatsTab id={id} team={team} />}
    </div>
  );
}

async function OverviewTab({ id, team }: { id: string; team: Team }) {
  const [roles, needs] = await Promise.all([
    apiFetch<TeamRoles>(`/teams/${id}/roles`, { revalidate: 60 }),
    // top_n only controls the length of `weaknesses` below -- full_profile
    // always returns every category regardless, which is what the Team
    // Stat Profile chart uses.
    apiFetch<TeamNeeds>(`/teams/${id}/needs`, { params: { top_n: 3 }, revalidate: 60 }),
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
          label="Roster Avg Summit Score"
          value={roles.roster_avg_summit_score}
          hint={`Average Summit Score across every player on the roster with a real profile (not a limited-sample placeholder) -- a read on overall roster quality/depth, not just the best player.${roles.roster_avg_summit_score != null ? ` Averaged over ${roles.roster_avg_summit_score_count} player${roles.roster_avg_summit_score_count === 1 ? "" : "s"}.` : ""}`}
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
          Team Stat Profile
          <span className="hint" title="Every category from Full Stats Breakdown, shown as how far above or below the league average this team is (in standard deviations). Bars to the right of center are a strength, bars to the left are a weakness -- the further from center, the more it stands out.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Where this team stands out and where it doesn&apos;t, at a glance -- each bar is this team&apos;s
          z-score vs. the league average in that category. See Stats Breakdown for the real per-game numbers
          behind each bar.
        </p>
        <TeamProfileChart profile={needs.full_profile} />
      </div>
    </div>
  );
}

// Diverging bar chart: one row per stat category, bar extends right (strength,
// var(--good)) or left (weakness, var(--warn)) from a center 0 line, scaled by
// z-score. Reuses the site's existing good/warn status tokens (already used for
// pill-good/pill-warn elsewhere) rather than introducing new chart colors.
function TeamProfileChart({ profile }: { profile: TeamNeedCategory[] }) {
  if (profile.length === 0) return <p className="empty-state">No stat profile available.</p>;
  const maxAbsZ = Math.max(...profile.map((c) => Math.abs(c.z)), 0.0001);
  // Sort strongest to weakest so the chart reads top-to-bottom like a ranking,
  // not in whatever order the API happened to return categories.
  const sorted = [...profile].sort((a, b) => b.z - a.z);
  return (
    <div style={{ marginTop: 4 }}>
      {sorted.map((c) => {
        const pct = (Math.abs(c.z) / maxAbsZ) * 50; // half-width max, diverges from center
        const positive = c.z >= 0;
        return (
          <div
            key={c.stat}
            style={{ display: "grid", gridTemplateColumns: "110px 1fr 56px", alignItems: "center", gap: 8, marginBottom: 7, fontSize: "0.82rem" }}
          >
            <div style={{ color: "var(--text)" }}>{titleCase(c.label)}</div>
            <div style={{ position: "relative", height: 10, background: "var(--bg-panel-2)", borderRadius: 4 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  borderRadius: 4,
                  background: positive ? "var(--good)" : "var(--warn)",
                  left: positive ? "50%" : undefined,
                  right: positive ? undefined : "50%",
                }}
              />
            </div>
            <div style={{ textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
              {c.z > 0 ? "+" : ""}
              {c.z.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function RosterTab({ id }: { id: string }) {
  const [roster, roles] = await Promise.all([
    apiFetch<Player[]>("/players", { params: { team_id: id, limit: 50 } }),
    apiFetch<TeamRoles>(`/teams/${id}/roles`, { revalidate: 60 }),
  ]);

  if (roster.length === 0) return <p className="empty-state">No players on record for this team.</p>;

  // roster_roles is the same Starter/Sixth Man/Role Player/Depth Piece
  // classification shown in aggregate on the Overview tab's Rotation
  // Minutes card, applied here per player -- matched by player_id, not
  // roster order, since /players and /teams/{id}/roles are two separate
  // fetches.
  const roleByPlayer = new Map(roles.roster_roles.map((r) => [r.player_id, r.role]));

  return (
    <div className="card">
      <h2>Roster</h2>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 16 }}>
        Role is this team&apos;s own real minutes-based rotation classification -- see the Rotation Minutes card
        on the Overview tab for how it&apos;s computed.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Height</th>
              <th>Class</th>
              <th>Role</th>
              <th>GP</th>
              <th>GS</th>
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
                <td>{roleByPlayer.get(p.player_id) ?? "--"}</td>
                <td>{p.games}</td>
                <td>{p.games_started ?? "--"}</td>
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

