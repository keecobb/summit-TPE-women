import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamRoles, TeamNeeds, TeamFits } from "@/lib/types";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let team: Team;
  try {
    team = await apiFetch<Team>(`/teams/${id}`, { revalidate: 60 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const [roles, needs, fits] = await Promise.all([
    apiFetch<TeamRoles>(`/teams/${id}/roles`, { revalidate: 60 }),
    apiFetch<TeamNeeds>(`/teams/${id}/needs`, { params: { top_n: 3 }, revalidate: 60 }),
    apiFetch<TeamFits>(`/teams/${id}/fits`, { params: { limit: 5 }, revalidate: 60 }),
  ]);

  return (
    <div>
      <h1>{team.name}</h1>
      <p className="subtitle">
        {team.division} &middot; {team.conference} &middot; <span className="pill">{team.tier}</span>
      </p>

      <div className="stat-grid" style={{ maxWidth: 400 }}>
        <Stat label="Rating" value={team.current_rating} highlight />
        <Stat label="SOS" value={team.sos} />
        <Stat label="Roster" value={roles.roster_size} />
      </div>

      <div className="card">
        <h2>Rotation minutes (this roster)</h2>
        <p className="section-note">
          Real minutes-based roles computed from this team&apos;s own current roster -- what &quot;Starter&quot; or
          &quot;Sixth Man&quot; actually means here.
        </p>
        <div className="stat-grid">
          <RoleStat label="Starter" role={roles.starter} />
          <RoleStat label="Sixth Man" role={roles.sixth_man} />
          <RoleStat label="Role Player" role={roles.role_player} />
          <RoleStat label="Depth Piece" role={roles.depth_piece} />
        </div>
      </div>

      <div className="card">
        <h2>Biggest needs</h2>
        <p className="section-note">Weakest categories vs. {needs.comparison_group}.</p>
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
                <td>{w.label}</td>
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

      <div className="card">
        <h2>Best transfer fits</h2>
        <p className="section-note">
          Top candidates by projected {fits.stat_label} if they transferred in -- a plain ranking, not filtered by
          recruiting realism.
        </p>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Current team</th>
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
      <div className="label">{label}{role ? " min" : ""}</div>
    </div>
  );
}
