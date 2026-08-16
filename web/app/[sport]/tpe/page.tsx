import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Player, Team, ProjectionResult } from "@/lib/types";
import { ROLE_NAMES, roleLabel } from "@/lib/types";
import Typeahead from "@/components/Typeahead";
import FilterForm from "@/components/FilterForm";
import FlowSteps from "@/components/FlowSteps";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

interface SP {
  search?: string;
  team_id?: string;
  player_id?: string;
  target_team_id?: string;
  role?: string;
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
              placeholder="e.g. Anguera"
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

          <div className="field">
            <label htmlFor="role">Projected role</label>
            <select id="role" name="role" defaultValue="">
              <option value="">Auto (based on current minutes)</option>
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>

          <div className="section-note">Or set exact minutes instead of a role:</div>
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

// ---- Step 3: side-by-side comparison ----
async function ResultView({ sp, sport }: { sp: SP; sport: string }) {
  let result: ProjectionResult;
  try {
    result = await apiFetch<ProjectionResult>(`/${sport}/project`, {
      params: { player_id: sp.player_id, target_team_id: sp.target_team_id, role: sp.role, minutes: sp.minutes },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return (
        <div>
          <h1>Transfer Projection</h1>
          <div className="error-box">{e.message}</div>
          <Link className="btn" href={`/${sport}/tpe?player_id=${sp.player_id}`}>
            &larr; Try a different school
          </Link>
        </div>
      );
    }
    throw e;
  }

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
  // on its own (the previous layout) it had no reference point.
  const currentTeamRating = result.target.current_rating - result.strength_gap;

  return (
    <div>
      {navButtons}

      <h1>
        {result.player.name}: {result.player.current_team} &rarr; {result.target.team}
      </h1>
      <p className="subtitle">
        {result.player.current_tier} to {result.target.tier} &middot; Confidence: <strong>{result.confidence}</strong>
      </p>

      <div className="card">
        <h2>Side by side</h2>
        <p className="section-note">
          {result.role_applied
            ? `Assuming ${roleLabel(result.role_applied.role)} minutes at ${result.target.team} (${result.projected.minutes?.toFixed(1)}/game)`
            : `Projected minutes: ${result.projected.minutes?.toFixed(1)}/game`}
        </p>
        <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <h3 style={{ fontSize: "1rem", margin: "0 0 10px" }}>{result.player.current_team} (now)</h3>
            <table>
              <tbody>
                <StatRow label="GP" value={result.player.games} decimals={0} />
                <StatRow label="GS" value={result.player.games_started} decimals={0} />
                <StatRow label="MPG" value={result.current.avg_minutes} />
                <StatRow label="PPG" value={result.current.ppg} />
                <StatRow label="RPG" value={result.current.rpg} />
                <StatRow label="APG" value={result.current.apg} />
                <StatRow label="SPG" value={result.current.spg} />
                <StatRow label="BPG" value={result.current.bpg} />
                <StatRow label="TS%" value={result.current.ts_pct} />
                <StatRow label="Summit Score" value={result.current.hoop_score} highlight />
              </tbody>
            </table>
          </div>
          <div>
            <h3 style={{ fontSize: "1rem", margin: "0 0 10px" }}>{result.target.team} (projected)</h3>
            <table>
              <tbody>
                <StatRow label="MPG" value={result.projected.minutes} />
                <StatRow label="PPG" value={result.projected.ppg} />
                <StatRow label="RPG" value={result.projected.rpg} />
                <StatRow label="APG" value={result.projected.apg} />
                <StatRow label="SPG" value={result.projected.spg} />
                <StatRow label="BPG" value={result.projected.bpg} />
                <StatRow label="TS%" value={result.projected.ts_pct} />
                <StatRow label="Summit Score" value={result.projected.hoop_score} highlight />
              </tbody>
            </table>
          </div>
        </div>
        {!result.extreme_mismatch && (
          <p className="section-note" style={{ marginTop: 12 }}>
            {plainLanguageNote(result)}
          </p>
        )}
      </div>

      <div className="card">
        <h2>
          Comparison Chart
          <span className="hint" title="Same numbers as the Side by Side table above, laid out as bars so the size of the change is easier to see at a glance.">
            ?
          </span>
        </h2>
        <p className="section-note">
          {result.player.current_team} (now) vs. {result.target.team} (projected), bar for bar.
        </p>
        <ProjectionCompareChart result={result} />
      </div>

      <div className="card">
        <h2>Background</h2>
        <p className="section-note">
          Team Rating is each school&apos;s overall strength on one shared scale (see the Glossary for how
          it&apos;s built) -- shown for both schools here so the Rating Difference below actually means
          something on its own, instead of one team&apos;s number with nothing to compare it to.
        </p>
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="value">{currentTeamRating.toFixed(1)}</div>
            <div className="label">
              {result.player.current_team} rating ({result.player.current_tier})
            </div>
          </div>
          <div className="stat-tile">
            <div className="value">{result.target.current_rating.toFixed(1)}</div>
            <div className="label">
              {result.target.team} rating ({result.target.tier})
            </div>
          </div>
          <div className="stat-tile">
            <div className="value" style={{ color: result.strength_gap >= 0 ? "var(--good)" : "var(--warn)" }}>
              {result.strength_gap >= 0 ? "+" : ""}
              {result.strength_gap.toFixed(1)}
            </div>
            <div className="label">
              Rating difference
              <span className="hint" title="How much stronger (positive) or weaker (negative) the target team is than the current team, on the same rating scale shown above. This is what actually drives the projection -- a bigger gap means a bigger change in expected production.">
                ?
              </span>
            </div>
          </div>
          <div className="stat-tile">
            <div className="value">{result.player.class_year}</div>
            <div className="label">Class</div>
          </div>
          <div className="stat-tile">
            <div className="value">
              {result.player.games}
              {result.player.games_started != null ? ` / ${result.player.games_started}` : ""}
            </div>
            <div className="label">GP / GS this season</div>
          </div>
          <div className="stat-tile">
            <div className="value">{formatMinutesSource(result.minutes_source)}</div>
            <div className="label">Minutes source</div>
          </div>
        </div>
      </div>

      {result.extreme_mismatch && result.extreme_mismatch_note && (
        <div className="info-box">{result.extreme_mismatch_note}</div>
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

function StatRow({
  label, value, highlight, decimals = 1,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
  decimals?: number;
}) {
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{label}</td>
      <td style={highlight ? { color: "var(--accent)", fontWeight: 700, textAlign: "right" } : { textAlign: "right" }}>
        {value != null ? value.toFixed(decimals) : "--"}
      </td>
    </tr>
  );
}

// Paired current-vs-projected bars, one pair per stat, reusing the same
// bar-row/bar-track/bar-fill visual language as the Data page's charts --
// each row is scaled to its OWN max (current vs projected for that one
// stat), not a shared scale, since PPG/TS%/Summit Score all live on very
// different numeric ranges and a single shared scale would flatten most
// rows to nothing.
function ProjectionCompareChart({ result }: { result: ProjectionResult }) {
  const rows: { key: string; label: string; current: number | undefined; projected: number | undefined }[] = [
    { key: "ppg", label: "PPG", current: result.current.ppg, projected: result.projected.ppg },
    { key: "rpg", label: "RPG", current: result.current.rpg, projected: result.projected.rpg },
    { key: "apg", label: "APG", current: result.current.apg, projected: result.projected.apg },
    { key: "spg", label: "SPG", current: result.current.spg, projected: result.projected.spg },
    { key: "bpg", label: "BPG", current: result.current.bpg, projected: result.projected.bpg },
    { key: "ts_pct", label: "TS%", current: result.current.ts_pct, projected: result.projected.ts_pct },
    { key: "hoop_score", label: "Summit Score", current: result.current.hoop_score, projected: result.projected.hoop_score },
  ];
  return (
    <div>
      {rows.map((r) => {
        const max = Math.max(r.current ?? 0, r.projected ?? 0, 0.0001);
        return (
          <div key={r.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 4, fontWeight: 600 }}>
              {r.label}
            </div>
            <div className="bar-row">
              <div className="bar-name">{result.player.current_team}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${((r.current ?? 0) / max) * 100}%`, background: "var(--text-dim)" }}
                />
              </div>
              <div className="bar-value">{r.current?.toFixed(1) ?? "--"}</div>
            </div>
            <div className="bar-row">
              <div className="bar-name">{result.target.team}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${((r.projected ?? 0) / max) * 100}%` }} />
              </div>
              <div className="bar-value">{r.projected?.toFixed(1) ?? "--"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
