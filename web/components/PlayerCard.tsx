import type { PlayerDetail } from "@/lib/types";

/**
 * Small identity card at the top of a player's profile -- name, class,
 * position, height, school, and Summit Score at a glance, before any of
 * the stat detail below. Separate from the page's h1/subtitle line (kept
 * for the page title and thin-sample flag) -- this is a compact reference
 * card a coach can screenshot or glance at on its own.
 */
export default function PlayerCard({ player }: { player: PlayerDetail }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
      <div>
        <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{player.name}</div>
        <div className="section-note" style={{ margin: "4px 0 0" }}>
          {player.class_year} &middot; {player.position}
          {player.height ? ` · ${player.height}` : ""} &middot; {player.team_name ?? "--"}
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
          {player.hoop_score != null ? player.hoop_score.toFixed(1) : "--"}
        </div>
        <div className="section-note" style={{ margin: "2px 0 0", textTransform: "uppercase", fontSize: "0.72rem", letterSpacing: "0.03em" }}>
          Summit Score
        </div>
      </div>
    </div>
  );
}
