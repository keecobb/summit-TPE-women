import type { RoleName, RoleTranslation, RoleTranslationLine } from "@/lib/types";
import { ROLE_NAMES, roleLabel } from "@/lib/types";

// Player profile page (phase 12) -- "how would she translate into a
// different role on her CURRENT team." Same team, same competition level,
// just her real per-40 rates applied to each role's typical minutes on her
// own roster (via /teams/{id}/roles). Deliberately NOT a transfer
// projection -- see role_translation()'s docstring in projection.py for
// why /project's model doesn't apply here. Summit Score/TS%/FG% are
// rate-based composites that don't change across roles, so they're shown
// once above the 4 role cards rather than repeated (and re-implying a
// change that isn't real) inside each one.
export default function RoleTranslationCard({ data }: { data: RoleTranslation }) {
  return (
    <div className="card">
      <h2>
        Role Translation
        <span
          className="hint"
          title="Not a transfer projection -- this is her own real per-40 production, applied to what each role typically plays on her own current roster. Same team, same competition level."
        >
          ?
        </span>
      </h2>
      <p className="section-note">
        How {data.name.split(" ")[0]}&apos;s real production would look in each of this roster&apos;s 4
        minutes-based roles, on {data.team_name} specifically -- not a projection to a new school. Her real
        current role is highlighted below.
      </p>

      <div className="stat-grid" style={{ maxWidth: 480, marginBottom: 16 }}>
        <Stat label="Real MPG" value={data.real_avg_minutes} />
        <Stat label="Summit Score" value={data.hoop_score} highlight />
        <Stat label="TS%" value={data.ts_pct} />
        <Stat label="FG%" value={data.fg_pct} />
      </div>

      <div className="card-grid">
        {ROLE_NAMES.map((role) => (
          <RoleTranslationTile key={role} role={role} line={data.roles[role]} isCurrent={data.current_role === role} />
        ))}
      </div>

      <p className="section-note" style={{ marginTop: 12 }}>{data.note}</p>
    </div>
  );
}

function RoleTranslationTile({
  role, line, isCurrent,
}: {
  role: RoleName;
  line: RoleTranslationLine | null;
  isCurrent: boolean;
}) {
  return (
    <div
      className="card"
      style={isCurrent ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}
    >
      <h3 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        {roleLabel(role)}
        {isCurrent && <span className="pill pill-good">her role today</span>}
      </h3>
      {line ? (
        <>
          <p className="section-note" style={{ margin: "0 0 10px" }}>{line.minutes.toFixed(1)} min/game</p>
          <div className="stat-grid">
            <Stat label="PPG" value={line.ppg} />
            <Stat label="RPG" value={line.rpg} />
            <Stat label="APG" value={line.apg} />
            <Stat label="SPG" value={line.spg} />
            <Stat label="BPG" value={line.bpg} />
            <Stat label="TOPG" value={line.topg} />
          </div>
        </>
      ) : (
        <p className="section-note">Not enough real data on this roster to resolve typical minutes for this role.</p>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number | null | undefined; highlight?: boolean }) {
  return (
    <div className="stat-tile">
      <div className="value" style={highlight ? { color: "var(--accent)" } : undefined}>
        {value != null ? value.toFixed(1) : "--"}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
