import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Team, LeaderboardPlayer, PlayerLeaderboard, SeasonJumpLeaderboard } from "@/lib/types";

// Renders per-request instead of being statically prerendered at build
// time -- this page fetches live data, and a build shouldn't hard-fail
// just because the API happens to be unreachable at deploy time.
export const dynamic = "force-dynamic";

const SPORT_LABEL: Record<string, string> = { women: "women's", men: "men's" };

export default async function HomePage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const otherSport = sport === "men" ? "women" : "men";
  const label = SPORT_LABEL[sport] ?? "women's";
  const otherLabel = SPORT_LABEL[otherSport] ?? "men's";

  // Live snapshots for the "what this actually looks like" section --
  // pulled from the real API so this never drifts out of sync with what
  // the rest of the site shows. Small, cheap calls; safe to run on every
  // home page load with the normal 60s revalidate window.
  const [topTeams, topScorers, seasonJump] = await Promise.all([
    apiFetch<Team[]>(`/${sport}/teams`, { params: { limit: 5 } }),
    apiFetch<PlayerLeaderboard>(`/${sport}/leaderboards/players`, { params: { stat: "ppg", min_games: 10, limit: 5 } }),
    apiFetch<SeasonJumpLeaderboard>(`/${sport}/leaderboards/season-jump`, { params: { min_games: 8, limit: 3 } }),
  ]);

  return (
    <div>
      <section className="hero">
        <div className="notice-banner">All features are free and fully open during this preview period.</div>
        <h1>Summit</h1>
        <p className="subtitle" style={{ maxWidth: 68 + "ch" }}>
          Advanced college basketball team and player statistics, analytics, and transfer projections -- covering
          all of D1 {label} and {otherLabel} hoops on their own separate scales. You&apos;re viewing the{" "}
          {label} side; <Link href={`/${otherSport}`}>switch to {otherLabel}</Link> any time.{" "}
          Start with <Link href={`/${sport}/tpe`}>Transfer Projection</Link>: pick a player, pick a target school, and
          see a real projected stat line based on how actual transfers have played out, not a guess.
        </p>
        <div className="hero-actions">
          <Link href={`/${sport}/tpe`} className="btn btn-primary">
            Open Transfer Projection
          </Link>
          <Link href={`/${sport}/team-fits`} className="btn">
            Find team fits
          </Link>
          <Link href={`/${sport}/data`} className="btn">
            Browse the data
          </Link>
        </div>
      </section>

      <div className="card">
        <h2>
          How Summit Scores Work
          <span className="hint" title="A single 30-99 number summarizing a player's overall production this season -- position-weighted, opponent-strength-adjusted per-40 output, converted to a z-score against the season's full player pool, then mapped onto a 30-99 scale that saturates smoothly near the top instead of hard-clamping.">
            ?
          </span>
        </h2>
        <p className="section-note">
          Every player on the site gets one number, 30-99, for how good their season has actually been -- adjusted
          for role and opponent strength, so a star on a weak schedule and a star on a brutal one are genuinely
          comparable. Higher is better; 99 is reserved for the very best few players in the country, not handed
          out to dozens of players.
        </p>
        <div style={{ margin: "16px 0 4px", position: "relative", height: 34 }}>
          <div
            style={{
              position: "absolute", left: 0, right: 0, top: 12, height: 10, borderRadius: 6,
              background: "linear-gradient(90deg, var(--bg-panel-2), var(--accent))",
              border: "1px solid var(--border)",
            }}
          />
          <div style={{ position: "absolute", left: 0, top: 0, fontSize: 12, color: "var(--text-dim)" }}>30 (floor)</div>
          <div style={{ position: "absolute", right: 0, top: 0, fontSize: 12, color: "var(--text-dim)" }}>99 (elite)</div>
        </div>
        <p className="section-note" style={{ marginTop: 24 }}>
          Want the full plain-language breakdown of how the model works? See the About page.
        </p>
      </div>

      <div className="card">
        <h2>
          Biggest Summit Score Jumps, {seasonJump.season_from} &rarr; {seasonJump.season_to}
          <span className="hint" title={seasonJump.note}>
            ?
          </span>
        </h2>
        <p className="section-note">
          A real season-over-season comparison, not a projection -- the players whose Summit Score improved the
          most from last season to this one. See the full list, and the standard Top 5 Teams board, on the{" "}
          <Link href={`/${sport}/data`}>Data page</Link>.
        </p>
        <div className="stat-grid">
          {seasonJump.players.slice(0, 3).map((p) => (
            <Link href={`/${sport}/players/${p.player_id}`} key={p.player_id} style={{ textDecoration: "none" }}>
              <div className="stat-tile">
                <div className="value" style={{ color: "var(--good)" }}>
                  +{p.hoop_score_change.toFixed(1)}
                </div>
                <div className="label">
                  {p.name} ({p.to_team_name}) -- {p.from_hoop_score.toFixed(1)} &rarr; {p.to_hoop_score.toFixed(1)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="card-grid">
        <Link href={`/${sport}/tpe`}>
          <div className="card">
            <h2>Transfer Projection</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Pick a player, pick a new school, pick a role or set exact minutes -- see their projected production
              side by side with what they're doing today.
            </p>
          </div>
        </Link>
        <Link href={`/${sport}/team-fits`}>
          <div className="card">
            <h2>Team Fits</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Tell it what you need -- a stat, a level, a role to fill -- and get the top 20 players who'd
              project best into that spot on your roster.
            </p>
          </div>
        </Link>
        <Link href={`/${sport}/data`}>
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
          {topTeams.slice(0, 3).map((t) => (
            <div className="stat-tile" key={t.team_id}>
              <div className="value">{t.current_rating.toFixed(1)}</div>
              <div className="label">
                {t.name} ({t.tier})
              </div>
            </div>
          ))}
          {topScorers.players.slice(0, 3).map((p: LeaderboardPlayer) => (
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
        <h2>Follow Summit TPE</h2>
        <p className="section-note">
          Live highlights, leaderboard updates, and transfer buzz -- follow along on X and Instagram.
          (An embedded live feed isn&apos;t available yet since that requires the account&apos;s own API access;
          for now this links straight out to the profiles.)
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <a href="https://twitter.com/SummitTPE" target="_blank" rel="noopener noreferrer" className="btn">
            @SummitTPE on X
          </a>
          <a href="https://instagram.com/SummitTPE" target="_blank" rel="noopener noreferrer" className="btn">
            @SummitTPE on Instagram
          </a>
        </div>
      </div>

      <p className="section-note" style={{ marginTop: 4 }}>
        Want the full rundown of everything on the site? See the <Link href={`/${sport}/about`}>About page</Link>.
      </p>
    </div>
  );
}
