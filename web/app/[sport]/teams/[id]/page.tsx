import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamRoles, TeamNeeds, TeamNeedCategory, Player, TeamSchedule, OptimalLineup, OptimalLineupPlayer } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import { titleCase } from "@/lib/format";
import RoleStat from "@/components/RoleStat";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
//
// Phase 11i/11j: `force-dynamic` only controls the Full Route Cache -- each
// `apiFetch()` call below still carries its own independent Data Cache
// entry, which a `revalidate: 60` option lets serve stale for up to 60
// real seconds regardless of this route-level setting. Phase 11i fixed
// this for the Summit Score/roster fields first (confirmed live against
// the running app, not just docs -- see the matching note on the player
// profile page); phase 11j extended it to every remaining fetch on this
// page (schedule, needs/stats breakdown) after the same staleness bug
// turned up on a section that phase 11i had assumed was low-risk enough
// to leave cached. Every fetch below is now `revalidate: 0` (always live).
export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "roster", label: "Roster" },
  { key: "schedule", label: "Schedule" },
  { key: "stats", label: "Stats Breakdown" },
  { key: "lineup", label: "Lineup" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { sport, id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  let team: Team;
  try {
    team = await apiFetch<Team>(`/${sport}/teams/${id}`, { revalidate: 0 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div>
      <h1>{team.name}</h1>
      <p className="subtitle">
        <Link href={`/${sport}/conferences/${encodeURIComponent(team.conference)}`}>{team.conference}</Link> &middot;{" "}
        <span className="pill">{team.tier}</span>
      </p>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 20, maxWidth: "68ch" }}>
        Overview covers this team&apos;s rating, its real minutes-based rotation roles, and its statistical
        profile vs. its peers. Roster, Schedule, and Stats Breakdown are full detail tabs below.
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/${sport}/teams/${id}?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab sport={sport} id={id} team={team} />}
      {tab === "roster" && <RosterTab sport={sport} id={id} />}
      {tab === "schedule" && <ScheduleTab sport={sport} id={id} />}
      {tab === "stats" && <StatsTab sport={sport} id={id} team={team} />}
      {tab === "lineup" && <LineupTab sport={sport} id={id} />}
    </div>
  );
}

async function OverviewTab({ sport, id, team }: { sport: string; id: string; team: Team }) {
  const [roles, needs] = await Promise.all([
    apiFetch<TeamRoles>(`/${sport}/teams/${id}/roles`, { revalidate: 0 }),
    // top_n only controls the length of `weaknesses` below -- full_profile
    // always returns every category regardless, which is what the Team
    // Stat Profile chart uses. revalidate: 0 (phase 11j) for the same
    // reason as everything else on this page now -- see the file-top note.
    apiFetch<TeamNeeds>(`/${sport}/teams/${id}/needs`, { params: { top_n: 3 }, revalidate: 0 }),
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

async function RosterTab({ sport, id }: { sport: string; id: string }) {
  const [roster, roles] = await Promise.all([
    apiFetch<Player[]>(`/${sport}/players`, { params: { team_id: id, limit: 50 }, revalidate: 0 }),
    apiFetch<TeamRoles>(`/${sport}/teams/${id}/roles`, { revalidate: 0 }),
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
                  <Link href={`/${sport}/players/${p.player_id}`}>{p.name}</Link>
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

async function ScheduleTab({ sport, id }: { sport: string; id: string }) {
  const schedule = await apiFetch<TeamSchedule>(`/${sport}/teams/${id}/schedule`, { params: { season: "2025-26" }, revalidate: 0 });

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
                  <Link href={`/${sport}/games/${g.game_id}`}>{formatGameDate(g.date)}</Link>
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

async function StatsTab({ sport, id, team }: { sport: string; id: string; team: Team }) {
  // top_n only controls how many are called out as "weaknesses" -- full_profile
  // always includes every tracked category regardless, so this just needs to be
  // a valid value (the API caps it at the total category count, currently 8).
  const needs = await apiFetch<TeamNeeds>(`/${sport}/teams/${id}/needs`, { params: { top_n: 8 }, revalidate: 0 });

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

async function LineupTab({ sport, id }: { sport: string; id: string }) {
  let lineup: OptimalLineup;
  try {
    lineup = await apiFetch<OptimalLineup>(`/${sport}/teams/${id}/optimal-lineup`, { revalidate: 0 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return (
        <p className="empty-state">
          Not enough players with real season profiles and per-game logs on this roster to suggest a lineup yet.
        </p>
      );
    }
    throw e;
  }

  return (
    <div className="card">
      <h2>
        Suggested Rotation
        <span
          className="hint"
          title="Ranked by an equal-weighted blend of Summit Score and season-average combined production (points + rebounds + assists + steals + blocks - turnovers per game), both compared only against this team's own roster. Starting 5 requires at least 1 Forward or Center (the two are treated as one interchangeable frontcourt pool) and at least 2 Guards for a realistic lineup; Sixth Man is the next-best player regardless of position."
        >
          ?
        </span>
      </h2>
      <p className="section-note">
        A data-driven suggestion based on real box-score production this season -- not a coaching decision. Minutes
        are each player&apos;s real season average, scaled so the whole roster adds up to a real game&apos;s{" "}
        <strong>{lineup.total_minutes.toFixed(1)}</strong> total player-minutes (200 = 5 on the floor x 40 minutes).
        PPG/RPG/APG/SPG/BPG/TOPG are projected at that scaled minutes figure; Summit Score/TS%/FG% don&apos;t change
        with minutes, so those are real season values. See <Link href={`/${sport}/teams/${id}?tab=roster`}>Roster</Link> for
        who actually starts today.
      </p>

      {lineup.notes.length > 0 && (
        <div className="info-box" style={{ marginBottom: 16 }}>
          {lineup.notes.map((n, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : "6px 0 0" }}>{n}</p>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Class</th>
              <th>Min</th>
              <th>PPG</th>
              <th>RPG</th>
              <th>APG</th>
              <th>SPG</th>
              <th>BPG</th>
              <th>TOPG</th>
              <th>TS%</th>
              <th>FG%</th>
              <th>Summit Score</th>
            </tr>
          </thead>
          <tbody>
            {lineup.rotation.map((p) => (
              <tr key={p.player_id}>
                <td>
                  <span className={p.role === "Starter" || p.role === "Sixth Man" ? "pill pill-good" : "pill"}>
                    {p.role}
                  </span>
                </td>
                <td>
                  <Link href={`/${sport}/players/${p.player_id}`}>{p.name}</Link>
                </td>
                <td>{p.position}</td>
                <td>{p.class_year}</td>
                <td>{p.minutes.toFixed(1)}</td>
                <td>{p.ppg != null ? p.ppg.toFixed(1) : "--"}</td>
                <td>{p.rpg != null ? p.rpg.toFixed(1) : "--"}</td>
                <td>{p.apg != null ? p.apg.toFixed(1) : "--"}</td>
                <td>{p.spg != null ? p.spg.toFixed(1) : "--"}</td>
                <td>{p.bpg != null ? p.bpg.toFixed(1) : "--"}</td>
                <td>{p.topg != null ? p.topg.toFixed(1) : "--"}</td>
                <td>{p.ts_pct != null ? `${p.ts_pct.toFixed(1)}%` : "--"}</td>
                <td>{p.fg_pct != null ? `${p.fg_pct.toFixed(1)}%` : "--"}</td>
                <td>{p.hoop_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ fontWeight: 700 }}>Team Total</td>
              <td style={{ fontWeight: 700 }}>{lineup.total_minutes.toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "ppg").toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "rpg").toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "apg").toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "spg").toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "bpg").toFixed(1)}</td>
              <td style={{ fontWeight: 700 }}>{sumStat(lineup.rotation, "topg").toFixed(1)}</td>
              <td className="section-note">--</td>
              <td className="section-note">--</td>
              <td className="section-note">--</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="section-note" style={{ marginTop: 12 }}>{lineup.method_note}</p>
    </div>
  );
}

// Plain sum across the whole rotation table for one projected per-game stat
// column -- null rows (a role with no per40 rate to project, extremely
// rare) contribute 0 rather than breaking the total.
function sumStat(
  rotation: OptimalLineupPlayer[],
  key: "ppg" | "rpg" | "apg" | "spg" | "bpg" | "topg"
): number {
  return rotation.reduce((sum, p) => sum + (p[key] ?? 0), 0);
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

