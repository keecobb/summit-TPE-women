import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { PlayerLeaderboard, StandoutsLeaderboard } from "@/lib/types";
import { LEADERBOARD_STATS, LEADERBOARD_STAT_LABELS } from "@/lib/types";

interface SP {
  stat?: string;
  level?: string;
  division?: string;
  min_games?: string;
}

export default async function DataPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const stat = sp.stat ?? "hoop_score";

  const [leaderboard, lmStandouts, mmStandouts] = await Promise.all([
    apiFetch<PlayerLeaderboard>("/leaderboards/players", {
      params: { stat, level: sp.level, division: sp.division, min_games: sp.min_games ?? 8, limit: 25 },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Low-Major", target_level: "P5", limit: 8 },
    }),
    apiFetch<StandoutsLeaderboard>("/leaderboards/standouts", {
      params: { level: "Mid-Major", target_level: "P5", limit: 8 },
    }),
  ]);

  return (
    <div>
      <h1>Data</h1>
      <p className="subtitle">Real season leaderboards and standout projections -- for coaches and fans alike.</p>

      <div className="card">
        <h2>Leaderboard</h2>
        <form className="filter-form" action="/data">
          <div className="field">
            <label htmlFor="stat">Stat</label>
            <select id="stat" name="stat" defaultValue={stat}>
              {LEADERBOARD_STATS.map((s) => (
                <option key={s} value={s}>
                  {LEADERBOARD_STAT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="level">Level</label>
            <select id="level" name="level" defaultValue={sp.level ?? ""}>
              <option value="">Whole league</option>
              <option value="P5">P5</option>
              <option value="Mid-Major">Mid-Major</option>
              <option value="Low-Major">Low-Major</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="division">Division</label>
            <select id="division" name="division" defaultValue={sp.division ?? ""}>
              <option value="">D1 + D2</option>
              <option value="D1">D1</option>
              <option value="D2">D2</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="min_games">Min. games</label>
            <input id="min_games" name="min_games" type="number" min={0} defaultValue={sp.min_games ?? "8"} />
          </div>
          <button className="btn btn-primary" type="submit">
            Update
          </button>
        </form>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Team</th>
              <th>Level</th>
              <th>{leaderboard.stat_label}</th>
              <th>Hoop Score</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.players.map((p, i) => (
              <tr key={p.player_id}>
                <td>{i + 1}</td>
                <td>
                  <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                </td>
                <td>{p.team_name}</td>
                <td>
                  <span className="pill">{p.tier}</span>
                </td>
                <td>{p.stat_value.toFixed(stat === "ts_pct" || stat === "fg_pct" ? 1 : 2)}</td>
                <td>{p.hoop_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Standouts projected at the P5 level</h2>
        <p className="section-note">
          {lmStandouts.synthetic_target_note}
        </p>
        <div className="card-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Low-Major &rarr; P5</h2>
            <StandoutTable data={lmStandouts} />
          </div>
          <div>
            <h2 style={{ fontSize: "1.05rem" }}>Mid-Major &rarr; P5</h2>
            <StandoutTable data={mmStandouts} />
          </div>
        </div>
      </div>

      <div className="error-box" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
        Not shown here: performance splits against a specific opponent tier (e.g. &quot;P5 players who perform
        best specifically against other P5 opponents&quot;). That needs a per-game log with each opponent&apos;s
        level attached, which isn&apos;t part of the current data model -- season totals only. The standout
        projections above are the closest honest answer available today: real current production, run through
        the same projection math as the TPE Engine against average competition at the target level.
      </div>
    </div>
  );
}

function StandoutTable({ data }: { data: StandoutsLeaderboard }) {
  if (data.players.length === 0) return <p className="empty-state">No qualifying players.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Current</th>
          <th>Proj. Hoop Score</th>
        </tr>
      </thead>
      <tbody>
        {data.players.map((p) => (
          <tr key={p.player_id}>
            <td>
              <Link href={`/players/${p.player_id}`}>{p.name}</Link>
              <div className="label" style={{ marginTop: 2 }}>
                {p.current_team}
              </div>
            </td>
            <td>{p.current_hoop_score.toFixed(1)}</td>
            <td style={{ color: "var(--accent)", fontWeight: 700 }}>{p.projected_hoop_score.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
