import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamRoles, TeamNeeds, TeamFits, Player, TeamSchedule } from "@/lib/types";
import { roleLabel } from "@/lib/types";
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
        {team.conference} &middot; <span className="pill">{team.tier}</span>
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
  const [roles, needs, fits] = await Promise.all([
    apiFetch<TeamRoles>(`/teams/${id}/roles`, { revalidate: 60 }),
    apiFetch<TeamNeeds>(`/teams/${id}/needs`, { params: { top_n: 3 }, revalidate: 60 }),
    apiFetch<TeamFits>(`/teams/${id}/fits`, { params: { limit: 5 }, revalidate: 60 }),
  ]);

  return (
    <div>
      <div className="stat-grid" style={{ maxWidth: 400 }}>
        <Stat label="Rating" value={team.current_rating} highlight />
        <Stat label="SOS" value={team.sos} />
        <Stat label="Roster" value={roles.roster_size} />
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
        <p className="section-note">Weakest categories vs. {needs.comparison_group}.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Team</th>
                <th>League Avg</th>
                <th>Z-score</th>
              </tr>
            </thead>
            <tbody>
              {needs.weaknesses.map((w) => (
                <tr key={w.stat}>
                  <td>{titleCase(w.label)}</td>
                  <td>{w.team_value?.toFixed(1)}</td>
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
        <h2>Best Transfer Fits</h2>
        <p className="section-note">
          Top candidates by projected {fits.stat_label} if they transferred in -- a plain ranking, not filtered by
          recruiting realism.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Current Team</th>
                <th>Level</th>
                <th>Class</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {fits.candidates.map((c) => (
                <tr key={c.player_id}>
                  <td>
                    <Link href={`/players/${c.player_id}`}>{c.name}</Link>
                  </td>
                  <td>{c.current_team}</td>
                  <td>
                    <span className="pill">{c.level}</span>
                  </td>
                  <td>{c.class_year}</td>
                  <td>{c.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <td>{formatGameDate(g.date)}</td>
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
        Every category vs. {needs.comparison_group}. {team.name} rating: {team.current_rating.toFixed(2)} &middot;
        SOS: {team.sos?.toFixed(2)}.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Team</th>
              <th>League Avg</th>
              <th>Z-score</th>
            </tr>
          </thead>
          <tbody>
            {needs.full_profile.map((w) => (
              <tr key={w.stat}>
                <td>{titleCase(w.label)}</td>
                <td>{w.team_value?.toFixed(1)}</td>
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

function Stat({ label, value, highlight }: { label: string; value: unknown; highlight?: boolean }) {
  const num = typeof value === "number" ? value.toFixed(2) : String(value ?? "--");
  return (
    <div className="stat-tile">
      <div className="value" style={highlight ? { color: "var(--accent)" } : undefined}>
        {num}
      </div>
      <div className="label">{label}</div>
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
