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
        <div className="notice-banner">All features are free and fully open during this preview period.</div>
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

      <div className="card">
        <h2>What is this, in plain terms?</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Summit TPE takes real women&apos;s college basketball stats and turns them into answers to three simple
          questions: how good is a team, really, compared to every other team in the country? How good is a
          player, accounting for her role and how tough her opponents were? And if a player switched schools, what
          would her stats actually look like at the new place? No spreadsheets, no digging through box scores by
          hand -- just search for a team or player and get a clear number.
        </p>
      </div>

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
              Low-Major/Mid-Major players project as standouts at the High-Major level.
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

      <div className="card">
        <h2>Everything on the site</h2>
        <p className="section-note">The full rundown, for anyone who wants more than the three highlights above.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
          {SITE_SECTIONS.map((s) => (
            <div key={s.href}>
              <Link href={s.href} style={{ fontWeight: 700, textDecoration: "none" }}>
                {s.label}
              </Link>
              <p className="subtitle" style={{ margin: "2px 0 0" }}>
                {s.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SITE_SECTIONS: { href: string; label: string; detail: string }[] = [
  {
    href: "/tpe",
    label: "TPE Engine",
    detail:
      "The core transfer projector -- pick any player and any target school, set her minutes or a role " +
      "(starter, sixth man, etc.), and see a full projected stat line at the new school, with a confidence read " +
      "and a real range of outcomes based on comparable real transfers.",
  },
  {
    href: "/team-fits",
    label: "Team Fits",
    detail:
      "The reverse direction -- tell it what a team needs (a stat category, a level, a role to fill) and it " +
      "ranks the players nationally who'd project best into that exact spot on that roster.",
  },
  {
    href: "/compare",
    label: "Compare",
    detail: "Pick any two players and see their current-season stat lines side by side, with the better value in each row called out.",
  },
  {
    href: "/data",
    label: "Data",
    detail:
      "Real leaderboards (not projections) -- top scorers, rebounders, most efficient shooters, conference " +
      "filters, who performs best against tougher competition, who's trending up as the season goes on, and " +
      "which Low-Major/Mid-Major players project as standouts at the High-Major level.",
  },
  {
    href: "/players",
    label: "Players",
    detail:
      "Search or browse every rostered D1 player -- sortable by any stat, with a full profile page per player " +
      "including season-by-season trends and splits against different opponent strengths.",
  },
  {
    href: "/teams",
    label: "Teams",
    detail:
      "Search or browse every D1 team, filterable by tier and conference, with a full team profile -- roster, " +
      "schedule, and a real Stats Breakdown tab showing how the team compares to its league and its conference.",
  },
  {
    href: "/glossary",
    label: "Glossary",
    detail: "Plain-language definitions for every stat and term used across the site -- Summit Score, tiers, SOS, per-40, and more.",
  },
];
