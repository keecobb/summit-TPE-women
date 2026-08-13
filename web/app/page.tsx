import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Team, LeaderboardPlayer, PlayerLeaderboard } from "@/lib/types";

// Renders per-request instead of being statically prerendered at build
// time -- this page fetches live data, and a build shouldn't hard-fail
// just because the API happens to be unreachable at deploy time (every
// other page here is already dynamic by virtue of reading searchParams;
// the home page has none, so it needs this explicitly).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Live snapshots for the "what this actually looks like" section --
  // pulled from the real API so this never drifts out of sync with what
  // the rest of the site shows. Small, cheap calls; safe to run on every
  // home page load with the normal 60s revalidate window.
  const [topTeams, topScorers] = await Promise.all([
    apiFetch<Team[]>("/teams", { params: { limit: 3 } }),
    apiFetch<PlayerLeaderboard>("/leaderboards/players", { params: { stat: "ppg", min_games: 10, limit: 3 } }),
  ]);

  return (
    <div>
      <section className="hero">
        <h1>Summit TPE</h1>
        <p className="subtitle" style={{ maxWidth: 68 + "ch" }}>
          A team strength rating that puts every D1 team on one shared scale, a per-player Summit Score built from
          role- and opponent-adjusted production, and a transfer-portal projector that turns "what would she look
          like at a different school" into an actual number -- grounded in how real transfers have historically
          played out, not a guess.
        </p>
        <div className="hero-actions">
          <Link href="/tpe" className="btn btn-primary">
            Open the TPE Engine
          </Link>
          <Link href="/team-fits" className="btn">
            Find team fits
          </Link>
          <Link href="/data" className="btn">
            Browse the data
          </Link>
        </div>
      </section>

      <div className="card-grid">
        <Link href="/tpe">
          <div className="card">
            <h2>TPE Engine</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Pick a player, pick a new school, pick a role or set exact minutes -- see her projected production
              side by side with what she's doing today.
            </p>
          </div>
        </Link>
        <Link href="/team-fits">
          <div className="card">
            <h2>Team Fits</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Tell it what you need -- a stat, a level, a role to fill -- and get the top 20 players who'd
              project best into that spot on your roster.
            </p>
          </div>
        </Link>
        <Link href="/data">
          <div className="card">
            <h2>Data</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Leaderboards built for coaches and fans alike -- top scorers, most efficient shooters, and which
              Low-Major/Mid-Major players project as standouts at the P5 level.
            </p>
          </div>
        </Link>
      </div>

      <div className="card">
        <h2>What the ratings actually look like right now</h2>
        <p className="section-note">Live from this season's data -- not a mockup.</p>
        <div className="stat-grid">
          {topTeams.map((t) => (
            <div className="stat-tile" key={t.team_id}>
              <div className="value">{t.current_rating.toFixed(1)}</div>
              <div className="label">
                {t.name} ({t.tier})
              </div>
            </div>
          ))}
          {topScorers.players.map((p: LeaderboardPlayer) => (
            <div className="stat-tile" key={p.player_id}>
              <div className="value" style={{ color: "var(--accent)" }}>
                {p.ppg.toFixed(1)} PPG
              </div>
              <div className="label">
                {p.name} ({p.team_name})
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
