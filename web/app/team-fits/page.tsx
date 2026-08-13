import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { Team, TeamFits } from "@/lib/types";
import { FIT_STATS, FIT_STAT_LABELS, ROLE_NAMES } from "@/lib/types";

interface SP {
  team_id?: string;
  team_search?: string;
  stats?: string | string[];
  min_games?: string;
  level?: string;
  role?: string;
  minutes?: string;
}

export default async function TeamFitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!sp.team_id) return <TeamPickerView sp={sp} />;
  return <FitsView sp={sp} />;
}

async function TeamPickerView({ sp }: { sp: SP }) {
  const teams = await apiFetch<Team[]>("/teams", { params: { search: sp.team_search, limit: 500 } });
  const byTier = groupBy(teams, (t) => t.tier);

  return (
    <div>
      <h1>Team Fits</h1>
      <p className="subtitle">Pick your team, then tell us what you&apos;re looking for.</p>

      <form className="filter-form" action="/team-fits">
        <div className="field">
          <label htmlFor="team_search">Filter teams</label>
          <input id="team_search" name="team_search" defaultValue={sp.team_search ?? ""} placeholder="e.g. Baylor" />
        </div>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Tier</th>
            <th>Conference</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(byTier).map(([tier, tteams]) =>
            tteams.map((t) => (
              <tr key={t.team_id}>
                <td>{t.name}</td>
                <td>
                  <span className="pill">{tier}</span>
                </td>
                <td>{t.conference}</td>
                <td>
                  <Link className="btn btn-primary" href={`/team-fits?team_id=${t.team_id}`}>
                    Choose &rarr;
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

async function FitsView({ sp }: { sp: SP }) {
  const team = await apiFetch<Team>(`/teams/${sp.team_id}`);
  const selectedStats = Array.isArray(sp.stats) ? sp.stats : sp.stats ? [sp.stats] : [];

  let fits: TeamFits | null = null;
  let error: string | null = null;
  try {
    fits = await apiFetch<TeamFits>(`/teams/${sp.team_id}/fits`, {
      params: {
        stats: selectedStats.length > 0 ? selectedStats : undefined,
        min_games: sp.min_games ?? 5,
        level: sp.level,
        role: sp.minutes ? undefined : sp.role,
        minutes: sp.minutes,
        limit: 20,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) error = e.message;
    else throw e;
  }

  return (
    <div>
      <h1>{team.name}: Team Fits</h1>
      <p className="subtitle">Top 20 players who&apos;d project best into what you&apos;re looking for.</p>

      <div className="card">
        <form action="/team-fits">
          <input type="hidden" name="team_id" value={sp.team_id} />

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.78rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Stat(s) you need -- leave blank to auto-pick this team&apos;s biggest weakness
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              {FIT_STATS.map((s) => (
                <label key={s} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", minWidth: "auto" }}>
                  <input type="checkbox" name="stats" value={s} defaultChecked={selectedStats.includes(s)} style={{ minWidth: "auto", width: 16 }} />
                  {FIT_STAT_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-form" style={{ marginBottom: 0 }}>
            <div className="field">
              <label htmlFor="level">Level</label>
              <select id="level" name="level" defaultValue={sp.level ?? ""}>
                <option value="">Any</option>
                <option value="P5">P5</option>
                <option value="Mid-Major">Mid-Major</option>
                <option value="Low-Major">Low-Major</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="min_games">Min. games played</label>
              <input id="min_games" name="min_games" type="number" min={0} defaultValue={sp.min_games ?? "5"} />
            </div>
            <div className="field">
              <label htmlFor="role">Role to fill</label>
              <select id="role" name="role" defaultValue={sp.role ?? ""}>
                <option value="">Each candidate&apos;s own auto minutes</option>
                {ROLE_NAMES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="minutes">...or exact minutes</label>
              <input id="minutes" name="minutes" type="number" min={0} max={40} step={0.5} defaultValue={sp.minutes ?? ""} />
            </div>
            <button className="btn btn-primary" type="submit">
              Search
            </button>
          </div>
        </form>
      </div>

      {error && <div className="error-box">{error}</div>}

      {fits && (
        <>
          <p className="section-note">
            Ranking on:{" "}
            <strong>{fits.stats.map((s) => s.label).join(" + ")}</strong>
            {fits.role_applied && ` -- assuming ${fits.role_applied.role.replace("_", " ")} minutes (${fits.role_applied.minutes.toFixed(1)}/game)`}
            {fits.minutes_applied != null && ` -- assuming ${fits.minutes_applied} minutes/game`} &middot;{" "}
            {fits.candidates_considered} candidates considered.
          </p>

          {fits.candidates.length === 0 ? (
            <p className="empty-state">No candidates matched those filters.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Current team</th>
                  <th>Level</th>
                  <th>Class</th>
                  <th>Projected</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {fits.candidates.map((c, i) => (
                  <tr key={c.player_id}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/players/${c.player_id}`}>{c.name}</Link>
                    </td>
                    <td>{c.current_team}</td>
                    <td>
                      <span className="pill">{c.level}</span>
                    </td>
                    <td>{c.class_year}</td>
                    <td>
                      {Object.entries(c.projected)
                        .filter(([k]) => k !== "minutes")
                        .map(([k, v]) => `${k.replace("per40_", "")}: ${typeof v === "number" ? v.toFixed(1) : v}`)
                        .join(", ")}
                    </td>
                    <td>
                      <span className={c.extreme_mismatch ? "pill pill-warn" : "pill pill-good"}>{c.confidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/team-fits">&larr; Choose a different team</Link>
      </p>
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}
