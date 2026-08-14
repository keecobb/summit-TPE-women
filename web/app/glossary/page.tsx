const TERMS: { term: string; body: string }[] = [
  {
    term: "Summit Score",
    body:
      "A single 30-99 number summarizing a player's overall production this season -- position-weighted, " +
      "opponent-strength-adjusted per-40 output, converted to a z-score against the season's full player pool, " +
      "then mapped onto a 30-99 scale that saturates smoothly near the top instead of hard-clamping (so only the " +
      "truly best few players in the country land on exactly 99.0, not dozens of them). Higher is better. Shown " +
      "on player profiles, leaderboards, and every projection.",
  },
  {
    term: "High-Major / Mid-Major / Low-Major (HM / MM / LM)",
    body:
      "The three competitive levels every team and player is grouped into, sourced from the workbook's own " +
      "School Level column. High-Major is the top level (the power conferences), Low-Major the deepest. Old " +
      "links or data using \"P5\" mean the same thing as High-Major.",
  },
  {
    term: "Current Rating",
    body:
      "A team's overall strength on one shared scale, computed from an iterative offense/defense rating system " +
      "over this season's real results (similar in spirit to KenPom-style ratings). Higher means stronger; " +
      "roughly centered on 0 across all of Division I.",
  },
  {
    term: "SOS (Strength of Schedule)",
    body: "The average Current Rating of a team's opponents this season -- how hard its schedule has been.",
  },
  {
    term: "Per-40",
    body:
      "A player's per-minute production extrapolated to a full 40-minute game, so a bench player who's " +
      "efficient in limited minutes can be compared fairly against a starter who plays 35+ minutes a night. " +
      "Team-level per-40 categories (on a team's Stats Breakdown tab) mean the analogous thing at the team " +
      "level: real season totals across the whole roster, normalized to one 40-minute game.",
  },
  {
    term: "TS% (True Shooting %)",
    body:
      "Scoring efficiency accounting for the extra value of 3-pointers and the cost of free throws, not just " +
      "raw field goal percentage. Requires a minimum shot-attempt volume to compute -- shown as \"--\" for a " +
      "player with too few attempts on record.",
  },
  {
    term: "FG% (Field Goal %)",
    body: "Made field goals divided by attempted field goals (2s and 3s combined). Same minimum-attempt floor as TS%.",
  },
  {
    term: "PPG / RPG / APG / SPG / BPG / TOPG",
    body: "Points, rebounds, assists, steals, blocks, and turnovers per game -- straightforward season averages.",
  },
  {
    term: "\"limited\" / limited sample",
    body:
      "A badge shown when a player's season (or one season in her trajectory) fell short of the usual floor for " +
      "a full profile (5 games / 100 total minutes this season), or when she has zero games logged at all. " +
      "She's still shown -- every rostered player should be findable -- but treat the numbers as a small, " +
      "noisier sample rather than a full-season read.",
  },
  {
    term: "National Percentile",
    body:
      "\"Top X%\" ranking by Summit Score among every full-profile player in the current season's cache -- gives " +
      "context for what a given score actually means beyond the raw number.",
  },
  {
    term: "Confidence (High / Medium / Low)",
    body:
      "How much to trust a specific transfer projection, based on games played, class year, and how big a jump " +
      "the target school represents. Lower confidence doesn't mean a worse player -- it means more uncertainty " +
      "in the exact projected numbers.",
  },
  {
    term: "Extreme Mismatch",
    body:
      "Flagged on a projection when the target school represents an unusually large strength gap for that " +
      "player (about 2+ standard deviations) -- treat the projected numbers as a reasoned estimate, not a " +
      "precise forecast, in these cases.",
  },
  {
    term: "Z-score",
    body:
      "How many standard deviations above or below a peer-group average a team or player is in some category. " +
      "0 is exactly average; +1.0 is solidly better than most peers; -1.0 is a real weakness relative to peers. " +
      "It measures how unusual a number is, not a percentage.",
  },
  {
    term: "Fit Score",
    body:
      "On Team Fits, when ranking by more than one stat category at once, each candidate's projected value in " +
      "every requested category is converted to a z-score and averaged into one composite number -- a simple, " +
      "unweighted way to combine categories, not a fitted or learned formula.",
  },
  {
    term: "Roles (Starter / Sixth Man / Role Player / Depth Piece)",
    body:
      "Minutes-based roles computed from a specific team's own current roster (not a league-wide standard) -- " +
      "\"Starter\" minutes on a deep roster is a different number than on a thin one. Used to project a transfer " +
      "candidate into a specific role on a target team instead of her own auto-projected minutes.",
  },
  {
    term: "Back Half of the Season",
    body:
      "A player's own games, split at the midpoint of games SHE played (not the calendar midpoint of the whole " +
      "season) -- compares her first-half scoring average to her second-half average, to surface who's trending " +
      "up (or down) rather than just a flat season average.",
  },
  {
    term: "Top 50 Opponents",
    body:
      "The 50 highest-Current-Rating teams -- either nationally (on a player's own profile splits) or within one " +
      "level specifically (on the Data page's level-scoped leaderboards, e.g. the 50 best Low-Major teams, not " +
      "every Low-Major team including its weakest).",
  },
];

export default function GlossaryPage() {
  return (
    <div>
      <h1>Glossary</h1>
      <p className="subtitle">What the numbers and terms on this site actually mean.</p>

      <div className="card">
        {TERMS.map((t) => (
          <div key={t.term} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: "1.05rem", marginBottom: 4 }}>{t.term}</h2>
            <p style={{ margin: 0, color: "var(--text-dim)" }}>{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
