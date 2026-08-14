// Shared by the team profile page's "Rotation Minutes" card and the Team
// Fits page's "Current Rotation" card -- both show the same 4 role-based
// minutes numbers (starter/sixth_man/role_player/depth_piece) computed by
// /teams/{id}/roles, so one component keeps them from drifting apart.
export default function RoleStat({
  label, role,
}: {
  label: string;
  role: { minutes: number | null; note?: string; player_count?: number } | null;
}) {
  // minutes can be null even when `role` itself exists -- role_player and
  // depth_piece are real averages of actual bench players (rank 7-and-later,
  // split by whether they still average 20+ minutes/game -- see
  // projection.py's team_roles()), and a team can simply have zero players
  // in one of those two buckets, not just a missing/thin roster.
  const minutes = role?.minutes ?? null;
  const hint = role?.note
    ? `${role.note}${role.player_count != null ? ` (${role.player_count} player${role.player_count === 1 ? "" : "s"} on this roster)` : ""}`
    : undefined;
  return (
    <div className="stat-tile">
      <div className="value">{minutes != null ? minutes.toFixed(1) : "--"}</div>
      <div className="label">
        {label}
        {minutes != null ? " min" : ""}
        {hint ? (
          <span className="hint" title={hint}>
            ?
          </span>
        ) : null}
      </div>
    </div>
  );
}
