import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Player, Team, ProjectionResult } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import Typeahead from "@/components/Typeahead";
import FilterForm from "@/components/FilterForm";
import FlowSteps from "@/components/FlowSteps";
import RoleCheckboxGroup from "@/components/RoleCheckboxGroup";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

// Search-box hint text is sport-specific -- a women's example name in the
// men's search box (or vice versa) reads like the men's side is an
// afterthought bolted onto a women's-first product. Same pattern as
// SPORT_LABEL on the home page.
const SPORT_HINT_PLAYER: Record<string, string> = { women: "Anguera", men: "Boozer" };

interface SP {
  search?: string;
  team_id?: string;
  player_id?: string;
  target_team_id?: string;
  // Up to 3 role lanes, compared side by side -- see RoleCheckboxGroup and
  // ResultView's multi-lane fetch below. A single old bookmarked link with
  // one bare ?role=starter still works fine (comes through as a string,
  // normalized to a 1-item array).
  role?: string | string[];
  minutes?: string;
}

export default async function TpePage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<SP>;
}) {
  const { sport } = await params;
  const sp = await searchParams;

  if (sp.player_id && sp.target_team_id) return <ResultView sp={sp} sport={sport} />;
  if (sp.player_id) return <TargetPickerView sp={sp} sport={sport} />;
  if (sp.team_id) return <RosterPickerView sp={sp} sport={sport} />;
  return <StartView sp={sp} sport={sport} />;
}

// ---- Step 1: find a player, either by name or by browsing a roster ----
async function StartView({ sp, sport }: { sp: SP; sport: string }) {
  const players = sp.search ? await apiFetch<Player[]>(`/${sport}/players`, { params: { search: sp.search, limit: 20 } }) : [];

  return (
    <div>
      <h1>Transfer Projection</h1>
      <p className="subtitle">Find the player you want to project -- search by name, or browse a team's roster.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 24, maxWidth: "68ch" }}>
        This is a 3-step flow: find a player below, pick a target school (plus an optional role or exact
        minutes) on the next screen, then see their projected stat line side by side with what they're doing
        today. The projection is grounded in how real transfers at a comparable strength gap have actually
        played out, not a hand-picked formula -- every result includes a confidence read and a real range,
        not just one number.
      </p>
      <p className="section-note" style={{ marginTop: -12, marginBottom: 24 }}>
        Comparing several names against the same open roster spot?{" "}
        <Link href={`/${sport}/tpe/batch`}>Try the batch scouting board</Link> instead of running this one player
        at a time.
      </p>

      <FlowSteps steps={["Find a player", "Pick their target school", "See the projection"]} />

      <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 32 }}>
        <div className="card">
          <h2>Search by name</h2>
          <div className="field">
            <label htmlFor="tpe-player-search">Player name</label>
            <Typeahead
              sport={sport}
              kind="players"
              inputId="tpe-player-search"
              placeholder={`e.g. ${SPORT_HINT_PLAYER[sport] ?? SPORT_HINT_PLAYER.women}`}
              mode="navigate"
              hrefTemplate={`/${sport}/tpe?player_id={id}`}
              defaultValue={sp.search}
            />
          </div>
          <p className="section-note" style={{ marginTop: 10, marginBottom: 0 }}>
            Start typing a name and pick from the list.
          </p>
        </div>

        <div className="card">
          <h2>Browse by team</h2>
          <div className="field">
            <label htmlFor="tpe-team-browse">Team</label>
            <Typeahead
              sport={sport}
              kind="teams"
              inputId="tpe-team-browse"
              placeholder="e.g. UConn"
              mode="navigate"
              hrefTemplate={`/${sport}/tpe?team_id={id}`}
            />
          </div>
          <p className="section-note" style={{ marginTop: 10, marginBottom: 0 }}>
            Start typing a school and pick from the list to see its roster.
          </p>
        </div>
      </div>

      {sp.search && players.length === 0 && <p className="empty-state">No players match &quot;{sp.search}&quot;.</p>}

      {players.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Pos</th>
                <th>PPG</th>
                <th>Summit Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.player_id}>
                  <td>{p.name}</td>
                  <td>{p.team_name ?? "--"}</td>
                  <td>{p.position}</td>
                  <td>{p.ppg?.toFixed(1)}</td>
                  <td>{p.hoop_score?.toFixed(1)}</td>
                  <td>
                    <Link className="btn" href={`/${sport}/tpe?player_id=${p.player_id}`}>
                      Choose &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Step 1b: pick a player from a specific team's roster ----
async function RosterPickerView({ sp, sport }: { sp: SP; sport: string }) {
  const [team, roster] = await Promise.all([
    apiFetch<Team>(`/${sport}/teams/${sp.team_id}`),
    apiFetch<Player[]>(`/${sport}/players`, { params: { team_id: sp.team_id, limit: 50 } }),
  ]);

  return (
    <div>
      <h1>{team.name} roster</h1>
      <p className="subtitle">Pick a player to project at a different school.</p>

      {roster.length === 0 ? (
        <p className="empty-state">No players on record for this team.</p>
      ) : (
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.player_id}>
                  <td>{p.name}</td>
                  <td>{p.position}</td>
                  <td>{p.class_year}</td>
                  <td>{p.ppg?.toFixed(1)}</td>
                  <td>{p.rpg?.toFixed(1)}</td>
                  <td>{p.apg?.toFixed(1)}</td>
                  <td>{p.hoop_score?.toFixed(1)}</td>
                  <td>
                    <Link className="btn" href={`/${sport}/tpe?player_id=${p.player_id}`}>
                      Choose &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href={`/${sport}/tpe`}>&larr; Start over</Link>
      </p>
    </div>
  );
}

// ---- Step 2: pick a target school + role/minutes ----
async function TargetPickerView({ sp, sport }: { sp: SP; sport: string }) {
  const player = await apiFetch<Player>(`/${sport}/players/${sp.player_id}`);

  return (
    <div>
      <h1>{player.name}</h1>
      <p className="subtitle">
        Currently: {player.position} at {player.team_name ?? "--"} &middot; {player.ppg?.toFixed(1)} PPG,{" "}
        {player.rpg?.toFixed(1)} RPG, {player.apg?.toFixed(1)} APG &middot; Summit Score{" "}
        {player.hoop_score?.toFixed(1)}
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Project to...</h2>
        <FilterForm className="filter-form" action={`/${sport}/tpe`} style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input type="hidden" name="player_id" value={player.player_id} />

          <div className="field">
            <label htmlFor="target_team_id">Target school</label>
            <Typeahead
              sport={sport}
              kind="teams"
              inputId="target_team_id"
              placeholder="Start typing a school..."
              mode="select"
              hiddenName="target_team_id"
              required
            />
          </div>

          <RoleCheckboxGroup />

          <div className="section-note">Or set exact minutes instead -- overrides every role lane above:</div>
          <div className="field">
            <label htmlFor="minutes">Minutes (0-40, optional)</label>
            <input id="minutes" name="minutes" type="number" min={0} max={40} step={0.5} />
          </div>

          <button className="btn btn-primary" type="submit" style={{ marginTop: 8 }}>
            Run projection
          </button>
        </FilterForm>
      </div>

      <Link href={`/${sport}/tpe`}>&larr; Search a different player</Link>
    </div>
  );
}

// A lane is one (role|minutes) variant of the projection, run as its own
// /project call -- see ResultView below for why this is N parallel calls
// instead of a single batch endpoint (there's no "one player, several
// roles" batch API, only "several players, one target team" -- reusing
// that would need a fake player-per-role trick, more confusing than just
// firing a few real requests in parallel).
interface Lane {
  key: string;
  label: string;
  role?: string;
  minutes?: number;
}
type LaneResult = Lane & ({ result: ProjectionResult; error?: undefined } | { result?: undefined; error: string });

const ROLE_LANE_LABELS: Record<string, string> = { auto: "Auto" };

function laneLabel(value: string): string {
  return ROLE_LANE_LABELS[value] ?? roleLabel(value);
}

// ---- Step 3: side-by-side comparison across up to 3 role lanes ----
async function ResultView({ sp, sport }: { sp: SP; sport: string }) {
  const minutesNum = sp.minutes && sp.minutes.trim() !== "" ? Number(sp.minutes) : undefined;

  let lanes: Lane[];
  if (minutesNum != null && !Number.isNaN(minutesNum)) {
    // Coach-set exact minutes always wins over any role selection -- see
    // RoleCheckboxGroup's own note saying so on the form.
    lanes = [{ key: "minutes", label: `${minutesNum} min (coach-set)`, minutes: minutesNum }];
  } else {
    const rawRoles = Array.isArray(sp.role) ? sp.role : sp.role ? [sp.role] : [];
    const values = (rawRoles.length > 0 ? rawRoles : ["auto"]).slice(0, 3);
    lanes = values.map((v) => (v === "auto" ? { key: "auto", label: laneLabel(v) } : { key: v, label: laneLabel(v), role: v }));
  }

  const laneResults: LaneResult[] = await Promise.all(
    lanes.map(async (lane): Promise<LaneResult> => {
      try {
        const result = await apiFetch<ProjectionResult>(`/${sport}/project`, {
          params: { player_id: sp.player_id, target_team_id: sp.target_team_id, role: lane.role, minutes: lane.minutes },
        });
        return { ...lane, result };
      } catch (e) {
        return { ...lane, error: e instanceof ApiError ? e.message : "Something went wrong running this projection." };
      }
    })
  );

  const successLanes = laneResults.filter((l): l is LaneResult & { result: ProjectionResult } => l.result != null);
  const failedLanes = laneResults.filter((l): l is LaneResult & { error: string } => l.error != null);

  if (successLanes.length === 0) {
    return (
      <div>
        <h1>Transfer Projection</h1>
        <div className="error-box">{failedLanes[0]?.error ?? "Couldn't run this projection."}</div>
        <Link className="btn" href={`/${sport}/tpe?player_id=${sp.player_id}`}>
          &larr; Try a different school
        </Link>
      </div>
    );
  }

  const headline = successLanes[0].result;

  const navButtons = (
    <div className="hero-actions" style={{ marginBottom: 24 }}>
      <Link className="btn" href={`/${sport}/tpe?player_id=${sp.player_id}`}>
        &larr; Try a different school
      </Link>
      <Link className="btn" href={`/${sport}/players/${sp.player_id}`}>
        Full player page &rarr;
      </Link>
    </div>
  );

  // The API returns the TARGET team's rating and the strength_gap between
  // the two teams, but not the current team's rating as its own field --
  // it's recoverable algebraically (strength_gap = target - current) so no
  // backend change is needed to show both teams' ratings side by side, which
  // is what makes a lone "target team rating" number mean anything -- shown
  // on its own (the previous layout) it had no reference point. Target-team
  // rating, strength gap, confidence, and extreme-mismatch status don't vary
  // by role/minutes lane (they're driven only by the two teams' strength,
  // not by how many minutes she'd play) -- so it's safe to read all of that
  // off just the first successful lane rather than repeating it per lane.
  const currentTeamRating = headline.target.current_rating - headline.strength_gap;

  return (
    <div>
      {navButtons}

      <h1>
        {headline.player.name}: {headline.player.current_team} &rarr; {headline.target.team}
      </h1>
      <p className="subtitle">
        {headline.player.current_tier} to {headline.target.tier} &middot; Confidence:{" "}
        <strong>{headline.confidence}</strong>
      </p>

      {failedLanes.length > 0 && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {failedLanes.map((l) => (
            <div key={l.key}>
              <strong>{l.label}:</strong> {l.error}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Side by side{successLanes.length > 1 ? ` -- ${successLanes.length} roles compared` : ""}</h2>
        {/* GP/GS only exists for the current team -- there's no real "games
            played" for a projection at a school the player hasn't played
            for. Shown as a note (same pattern used for the per-lane minutes
            basis below) instead of a table row, so every column keeps the
            same row count on narrow (mobile) widths. */}
        <p className="section-note">
          {headline.player.current_team} this season: {headline.player.games} GP
          {headline.player.games_started != null ? ` / ${headline.player.games_started} GS` : ""}
        </p>
        <div className="table-scroll">
          <MultiRoleTable current={headline.current} lanes={successLanes} />
        </div>
        {!headline.extreme_mismatch && (
          <p className="section-note" style={{ marginTop: 12 }}>
            {plainLanguageNote(headline)}
          </p>
        )}
      </div>

      <div className="card">
        <h2>
          Comparison Chart
          <span className="hint" title="Same numbers as the Side by Side table above, laid out as bars so the size of the change -- and the difference between role lanes -- is easier to see at a glance.">
            ?
          </span>
        </h2>
        <p className="section-note">
          {headline.player.current_team} (now) vs. {headline.target.team}, one bar per role compared.
        </p>
        <MultiRoleCompareChart current={headline.current} currentLabel={headline.player.current_team} lanes={successLanes} />
      </div>

      <div className="card">
        <h2>Background</h2>
        <p className="section-note">
          Team Rating is each school&apos;s overall strength on one shared scale (see the{" "}
          <Link href={`/${sport}/about?tab=glossary`}>Glossary</Link> for how it&apos;s built) -- shown for both
          schools here so the Rating Difference below actually means something on its own, instead of one
          team&apos;s number with nothing to compare it to.
        </p>
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="value">{currentTeamRating.toFixed(1)}</div>
            <div className="label">
              {headline.player.current_team} rating ({headline.player.current_tier})
            </div>
          </div>
          <div className="stat-tile">
            <div className="value">{headline.target.current_rating.toFixed(1)}</div>
            <div className="label">
              {headline.target.team} rating ({headline.target.tier})
            </div>
          </div>
          <div className="stat-tile">
            <div className="value" style={{ color: headline.strength_gap >= 0 ? "var(--good)" : "var(--warn)" }}>
              {headline.strength_gap >= 0 ? "+" : ""}
              {headline.strength_gap.toFixed(1)}
            </div>
            <div className="label">
              Rating difference
              <span className="hint" title="How much stronger (positive) or weaker (negative) the target team is than the current team, on the same rating scale shown above. This is what actually drives the projection -- a bigger gap means a bigger change in expected production.">
                ?
              </span>
            </div>
          </div>
          <div className="stat-tile">
            <div className="value">{headline.player.class_year}</div>
            <div className="label">Class</div>
          </div>
          <div className="stat-tile">
            <div className="value">
              {headline.player.games}
              {headline.player.games_started != null ? ` / ${headline.player.games_started}` : ""}
            </div>
            <div className="label">GP / GS this season</div>
          </div>
        </div>
      </div>

      {headline.extreme_mismatch && headline.extreme_mismatch_note && (
        <div className="info-box">{headline.extreme_mismatch_note}</div>
      )}
    </div>
  );
}

// The API's minutes_source is a machine-readable tag ("role:starter",
// "coach_override", "auto_projected") -- translate it to the same
// human-readable role labels used everywhere else on the site instead of
// showing the raw tag.
function formatMinutesSource(source: string): string {
  if (source.startsWith("role:")) return roleLabel(source.slice("role:".length));
  if (source === "coach_override") return "Coach-Set Minutes";
  if (source === "auto_projected") return "Auto-Projected";
  return source.replace(/_/g, " ");
}

// Plain-language framing for the confidence/range concept, aimed at a coach
// or a fan rather than someone who wants the raw statistics terminology
// (interquartile range, standard deviation, etc.) -- those numbers are
// still available via the API for anyone who wants them. Keyed purely off
// `confidence` (not `extreme_mismatch` too, as an earlier version did) so
// this doesn't double up with the separate extreme_mismatch_note callout
// above -- a page showing two different "this might be off" disclaimers
// back to back reads as less trustworthy, not more transparent.
function plainLanguageNote(result: ProjectionResult): string {
  const conf = result.confidence.toLowerCase();
  if (conf.includes("high")) {
    return "This is a close comparison -- the two schools are similar enough in strength that this projection should track pretty closely to reality.";
  }
  if (conf.includes("low")) {
    return "This is a bigger jump in competition level, so think of this as a strong directional read on what to expect rather than an exact stat line -- it's built the same way as every projection on this site, using real comparable transfers.";
  }
  return "This is a moderate jump in competition level -- a solid estimate, with a bit more natural variation than a same-level comparison would have.";
}

// Stat rows shown per lane -- shared by both the table and the chart below
// so the two never drift out of sync on which stats are covered.
const LANE_STAT_ROWS: { key: string; label: string; decimals?: number; highlight?: boolean }[] = [
  { key: "minutes_or_avg", label: "MPG" },
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "ts_pct", label: "TS%" },
  { key: "hoop_score", label: "Summit Score", highlight: true },
];

// Distinct colors per lane column, up to 3 -- the site's existing brand
// tones (gold/good-green/deep-green), reused here the same way the Full
// Team Profile and Opponent Splits charts already pick 2-3 genuinely
// distinguishable colors instead of shades of the same hue.
const LANE_COLORS = ["var(--accent)", "var(--good)", "var(--green)"];

function laneStatValue(lane: { result: ProjectionResult }, statKey: string): number | null | undefined {
  if (statKey === "minutes_or_avg") return lane.result.projected.minutes;
  return lane.result.projected[statKey];
}

// One row per stat, one column per successful role/minutes lane (plus a
// shared Current column) -- replaces the old fixed 2-column layout so up
// to 3 role projections are visible at once instead of only whichever one
// role was picked.
function MultiRoleTable({
  current,
  lanes,
}: {
  current: Record<string, number>;
  lanes: (Lane & { result: ProjectionResult })[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Now</th>
          {lanes.map((l, i) => (
            <th key={l.key} style={{ color: LANE_COLORS[i % LANE_COLORS.length] }}>
              {l.label}
              <div style={{ fontWeight: 400, fontSize: "0.75rem", color: "var(--text-dim)" }}>
                {l.result.projected.minutes?.toFixed(1)} min &middot; {formatMinutesSource(l.result.minutes_source)}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {LANE_STAT_ROWS.map((row) => (
          <tr key={row.key}>
            <td style={{ fontWeight: 600 }}>{row.label}</td>
            <td style={{ textAlign: "right", ...(row.highlight ? { color: "var(--accent)", fontWeight: 700 } : {}) }}>
              {(row.key === "minutes_or_avg" ? current.avg_minutes : current[row.key])?.toFixed(row.decimals ?? 1) ?? "--"}
            </td>
            {lanes.map((l) => {
              const v = laneStatValue(l, row.key);
              return (
                <td
                  key={l.key}
                  style={{ textAlign: "right", ...(row.highlight ? { color: "var(--accent)", fontWeight: 700 } : {}) }}
                >
                  {v != null ? v.toFixed(row.decimals ?? 1) : "--"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// One bar-group per stat: a "now" bar plus one bar per role lane, all
// scaled to that row's own shared max -- generalizes the old 2-bar
// current-vs-projected chart to N lanes instead of exactly 1.
function MultiRoleCompareChart({
  current,
  currentLabel,
  lanes,
}: {
  current: Record<string, number>;
  currentLabel: string;
  lanes: (Lane & { result: ProjectionResult })[];
}) {
  const chartRows = LANE_STAT_ROWS.filter((r) => r.key !== "minutes_or_avg");
  return (
    <div>
      {chartRows.map((row) => {
        const currentVal = current[row.key];
        const laneVals = lanes.map((l) => laneStatValue(l, row.key));
        const max = Math.max(currentVal ?? 0, ...laneVals.map((v) => v ?? 0), 0.0001);
        return (
          <div key={row.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 4, fontWeight: 600 }}>
              {row.label}
            </div>
            <div className="bar-row">
              <div className="bar-name">{currentLabel}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${((currentVal ?? 0) / max) * 100}%`, background: "var(--text-dim)" }}
                />
              </div>
              <div className="bar-value">{currentVal?.toFixed(1) ?? "--"}</div>
            </div>
            {lanes.map((l, i) => (
              <div className="bar-row" key={l.key}>
                <div className="bar-name">{l.label}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${((laneStatValue(l, row.key) ?? 0) / max) * 100}%`,
                      background: LANE_COLORS[i % LANE_COLORS.length],
                    }}
                  />
                </div>
                <div className="bar-value">{laneStatValue(l, row.key)?.toFixed(1) ?? "--"}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
