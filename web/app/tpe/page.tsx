import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Player, Team, ProjectionResult } from "@/lib/types";
import { ROLE_NAMES } from "@/lib/types";

interface SP {
  search?: string;
  team_id?: string;
  player_id?: string;
  target_team_id?: string;
  role?: string;
  minutes?: string;
}

export default async function TpePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  if (sp.player_id && sp.target_team_id) return <ResultView sp={sp} />;
  if (sp.player_id) return <TargetPickerView sp={sp} />;
  if (sp.team_id) return <RosterPickerView sp={sp} />;
  return <StartView sp={sp} />;
}

// ---- Step 1: find a player, either by name or by browsing a roster ----
async function StartView({ sp }: { sp: SP }) {
  const [players, teams] = await Promise.all([
    sp.search ? apiFetch<Player[]>("/players", { params: { search: sp.search, limit: 20 } }) : Promise.resolve([]),
    apiFetch<Team[]>("/teams", { params: { limit: 500 } }),
  ]);
  const byTier = groupBy(teams, (t) => t.tier);

  return (
    <div>
      <h1>TPE Engine</h1>
      <p className="subtitle">Find the player you want to project -- search by name, or browse a team's roster.</p>

      <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 32 }}>
        <div className="card">
          <h2>Search by name</h2>
          <form className="filter-form" action="/tpe">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="search">Player name</label>
              <input id="search" name="search" defaultValue={sp.search ?? ""} placeholder="e.g. Anguera" autoFocus />
            </div>
            <button className="btn btn-primary" type="submit">
              Search
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Browse by team</h2>
          <form className="filter-form" action="/tpe">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="team_id">Team</label>
              <select id="team_id" name="team_id" required defaultValue="">
                <option value="" disabled>
                  Choose a team...
                </option>
                {Object.entries(byTier).map(([tier, tteams]) => (
                  <optgroup key={tier} label={tier}>
                    {tteams.map((t) => (
                      <option key={t.team_id} value={t.team_id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit">
              View roster
            </button>
          </form>
        </div>
      </div>

      {sp.search && players.length === 0 && <p className="empty-state">No players match &quot;{sp.search}&quot;.</p>}

      {players.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Team</th>
              <th>Pos</th>
              <th>PPG</th>
              <th>Hoop Score</th>
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
                  <Link className="btn" href={`/tpe?player_id=${p.player_id}`}>
                    Choose &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Step 1b: pick a player from a specific team's roster ----
async function RosterPickerView({ sp }: { sp: SP }) {
  const [team, roster] = await Promise.all([
    apiFetch<Team>(`/teams/${sp.team_id}`),
    apiFetch<Player[]>("/players", { params: { team_id: sp.team_id, limit: 50 } }),
  ]);

  return (
    <div>
      <h1>{team.name} roster</h1>
      <p className="subtitle">Pick a player to project at a different school.</p>

      {roster.length === 0 ? (
        <p className="empty-state">No players on record for this team.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Class</th>
              <th>PPG</th>
              <th>RPG</th>
              <th>APG</th>
              <th>Hoop Score</th>
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
                  <Link className="btn" href={`/tpe?player_id=${p.player_id}`}>
                    Choose &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/tpe">&larr; Start over</Link>
      </p>
    </div>
  );
}

// ---- Step 2: pick a target school + role/minutes ----
async function TargetPickerView({ sp }: { sp: SP }) {
  const [player, teams] = await Promise.all([
    apiFetch<Player>(`/players/${sp.player_id}`),
    apiFetch<Team[]>("/teams", { params: { limit: 500 } }),
  ]);

  const byTier = groupBy(teams, (t) => t.tier);

  return (
    <div>
      <h1>{player.name}</h1>
      <p className="subtitle">
        Currently: {player.position} at {player.team_name ?? "--"} &middot; {player.ppg?.toFixed(1)} PPG,{" "}
        {player.rpg?.toFixed(1)} RPG, {player.apg?.toFixed(1)} APG &middot; Hoop Score {player.hoop_score?.toFixed(1)}
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Project to...</h2>
        <form className="filter-form" action="/tpe" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input type="hidden" name="player_id" value={player.player_id} />

          <div className="field">
            <label htmlFor="target_team_id">Target school</label>
            <select id="target_team_id" name="target_team_id" required defaultValue="">
              <option value="" disabled>
                Choose a team...
              </option>
              {Object.entries(byTier).map(([tier, tteams]) => (
                <optgroup key={tier} label={tier}>
                  {tteams.map((t) => (
                    <option key={t.team_id} value={t.team_id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="role">Projected role</label>
            <select id="role" name="role" defaultValue="">
              <option value="">Auto (based on current minutes)</option>
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
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
        </form>
      </div>

      <Link href="/tpe">&larr; Search a different player</Link>
    </div>
  );
}

// ---- Step 3: side-by-side comparison ----
async function ResultView({ sp }: { sp: SP }) {
  let result: ProjectionResult;
  try {
    result = await apiFetch<ProjectionResult>("/project", {
      params: { player_id: sp.player_id, target_team_id: sp.target_team_id, role: sp.role, minutes: sp.minutes },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return (
        <div>
          <h1>TPE Engine</h1>
          <div className="error-box">{e.message}</div>
          <Link className="btn" href={`/tpe?player_id=${sp.player_id}`}>
            &larr; Try a different school
          </Link>
        </div>
      );
    }
    throw e;
  }

  return (
    <div>
      <h1>
        {result.player.name}: {result.player.current_team} &rarr; {result.target.team}
      </h1>
      <p className="subtitle">
        {result.player.current_tier} to {result.target.tier} &middot; strength gap {result.strength_gap.toFixed(1)}{" "}
        ({result.gap_std >= 0 ? "+" : ""}
        {result.gap_std.toFixed(2)} SD) &middot; confidence: <strong>{result.confidence}</strong>
      </p>

      {result.extreme_mismatch && result.extreme_mismatch_note && (
        <div className="error-box">{result.extreme_mismatch_note}</div>
      )}

      <div className="card">
        <h2>Side by side</h2>
        <p className="section-note">
          {result.role_applied
            ? `Assuming ${result.role_applied.role.replace("_", " ")} minutes at ${result.target.team} (${result.projected.minutes?.toFixed(1)}/game)`
            : `Projected minutes: ${result.projected.minutes?.toFixed(1)}/game`}
        </p>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>{result.player.current_team} (now)</th>
              <th>{result.target.team} (projected)</th>
              <th>Range (p25-p75)</th>
            </tr>
          </thead>
          <tbody>
            <ComparisonRow label="PPG" current={result.current.ppg} projected={result.projected.ppg} range={result.projected_range.ppg} />
            <ComparisonRow label="RPG" current={result.current.rpg} projected={result.projected.rpg} range={result.projected_range.rpg} />
            <ComparisonRow label="APG" current={result.current.apg} projected={result.projected.apg} range={result.projected_range.apg} />
            <ComparisonRow label="SPG" current={result.current.spg} projected={result.projected.spg} range={result.projected_range.spg} />
            <ComparisonRow label="BPG" current={result.current.bpg} projected={result.projected.bpg} range={result.projected_range.bpg} />
            <ComparisonRow label="TS%" current={result.current.ts_pct} projected={result.projected.ts_pct} />
            <ComparisonRow label="Hoop Score" current={result.current.hoop_score} projected={result.projected.hoop_score} range={result.projected_range.hoop_score} highlight />
          </tbody>
        </table>
        {result.projected_range_note && <p className="section-note">{result.projected_range_note}</p>}
      </div>

      <div className="card">
        <h2>Background</h2>
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="value">{result.player.current_team}</div>
            <div className="label">Current team ({result.player.current_tier})</div>
          </div>
          <div className="stat-tile">
            <div className="value">{result.target.current_rating.toFixed(1)}</div>
            <div className="label">{result.target.team} rating</div>
          </div>
          <div className="stat-tile">
            <div className="value">{result.player.class_year}</div>
            <div className="label">Class / {result.player.games} GP this season</div>
          </div>
          <div className="stat-tile">
            <div className="value">{result.minutes_source.replace("_", " ")}</div>
            <div className="label">Minutes source</div>
          </div>
        </div>
      </div>

      <div className="hero-actions">
        <Link className="btn" href={`/tpe?player_id=${sp.player_id}`}>
          &larr; Try a different school
        </Link>
        <Link className="btn" href={`/players/${sp.player_id}`}>
          Full player page &rarr;
        </Link>
      </div>
    </div>
  );
}

function ComparisonRow({
  label,
  current,
  projected,
  range,
  highlight,
}: {
  label: string;
  current: number | undefined;
  projected: number | undefined;
  range?: [number, number] | string;
  highlight?: boolean;
}) {
  const rangeText = Array.isArray(range) ? `${range[0].toFixed(1)} - ${range[1].toFixed(1)}` : "--";
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{label}</td>
      <td>{current?.toFixed(1) ?? "--"}</td>
      <td style={highlight ? { color: "var(--accent)", fontWeight: 700 } : { fontWeight: 600 }}>
        {projected?.toFixed(1) ?? "--"}
      </td>
      <td>{rangeText}</td>
    </tr>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}
