import Link from "next/link";

// About, Glossary, and Contact used to be 3 separate nav links/pages --
// merged into one page with tabs (?tab=overview|glossary|contact, same
// URL-driven tab pattern as the team/player detail pages) since all 3 are
// "read this once, maybe come back to check a definition" content rather
// than tools someone jumps between mid-task. The old /[sport]/glossary and
// /[sport]/contact routes now redirect here with the matching tab
// preselected (see those files) so no old link/bookmark breaks.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "glossary", label: "Glossary" },
  { key: "contact", label: "Contact" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function AboutPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { sport } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  return (
    <div>
      <h1>About Summit TPE</h1>
      <p className="subtitle">What this site does, what the numbers mean, and how to reach us.</p>

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/${sport}/about?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab sport={sport} />}
      {tab === "glossary" && <GlossaryTab />}
      {tab === "contact" && <ContactTab />}
    </div>
  );
}

function OverviewTab({ sport }: { sport: string }) {
  const sections = siteSections(sport);
  return (
    <div>
      <div className="card card-prose">
        <h2>The product</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Summit TPE puts every D1 college basketball team (women&apos;s and men&apos;s) on one shared strength
          scale, scores every player with a role- and opponent-adjusted Summit Score, and projects what a
          player&apos;s production would look like at a different school -- grounded in how real transfers have
          actually played out, not a guess. Built for coaches evaluating transfer targets, and for anyone who
          wants a clearer read on team and player strength than raw box scores give you.
        </p>
      </div>

      <div className="card card-prose">
        <h2>How the numbers work</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Team strength ratings come from a margin-of-victory network run across every D1 game, so a mismatch a few
          links removed still informs a team&apos;s rating. Summit Score normalizes each player&apos;s per-40
          production for role and opponent strength. Transfer projections use a model fit directly against real
          transfers found in the underlying data -- not hand-picked constants -- and every projection ships with a
          real confidence read, not just a single number, so it reads as an honest estimate rather than a
          guarantee. Women&apos;s and men&apos;s data are always kept on their own separate scales -- a Summit
          Score is only ever meant to be compared within its own sport. See the{" "}
          <Link href={`/${sport}/about?tab=glossary`}>Glossary tab</Link> for definitions of every term used
          across the site.
        </p>
      </div>

      <div className="card card-prose">
        <h2>About the founder</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Summit TPE is built and maintained by Keeshaun Cobb, a former collegiate basketball player turned Data
          Analyst who loves to blend basketball and data. Summit TPE grew out of that combination -- a way to bring
          real statistical rigor to a conversation (transfer evaluation) that&apos;s usually driven by gut feel and
          highlight tape alone.
        </p>
      </div>

      <div className="card card-prose">
        <h2>Everything on the site</h2>
        <p className="section-note">The full rundown of every section, in one place.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
          {sections.map((s) => (
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

const GLOSSARY_TERMS: { term: string; body: string }[] = [
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
      "A badge shown when a player's season (or one season in their trajectory) fell short of the usual floor " +
      "for a full profile (5 games / 100 total minutes this season), or when they have zero games logged at " +
      "all. They're still shown -- every rostered player should be findable -- but treat the numbers as a " +
      "small, noisier sample rather than a full-season read.",
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
      "player (about 2+ standard deviations) -- the projection is still built the same way as any other, " +
      "just expect more game-to-game variation than usual for a jump this large.",
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
      "candidate into a specific role on a target team instead of their own auto-projected minutes -- Transfer " +
      "Projection can compare up to 3 of these roles side by side in one run.",
  },
  {
    term: "Back Half of the Season",
    body:
      "A player's own games, split at the midpoint of games THEY played (not the calendar midpoint of the whole " +
      "season) -- compares their first-half scoring average to their second-half average, to surface who's " +
      "trending up (or down) rather than just a flat season average.",
  },
  {
    term: "Top 50 Opponents",
    body:
      "The 50 highest-Current-Rating teams -- either nationally (on a player's own profile splits) or within one " +
      "level specifically (on the Data page's level-scoped leaderboards, e.g. the 50 best Low-Major teams, not " +
      "every Low-Major team including its weakest).",
  },
  {
    term: "Returning Roster (Team Fits)",
    body:
      "Team Fits' default view of a team's needs -- this past season's Seniors and Grad students excluded, " +
      "since they won't be back next season. Still an approximation off last season's game logs, not a " +
      "finalized next-season roster (incoming transfers/signees and underclassmen transferring out aren't " +
      "reflected). A toggle switches back to the full-roster view for reference.",
  },
];

function GlossaryTab() {
  return (
    <div>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 16, maxWidth: "68ch" }}>
        What the numbers and terms on this site actually mean.
      </p>
      <div className="card">
        {GLOSSARY_TERMS.map((t) => (
          <div key={t.term} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: "1.05rem", marginBottom: 4 }}>{t.term}</h2>
            <p style={{ margin: 0, color: "var(--text-dim)" }}>{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactTab() {
  return (
    <div>
      <p className="section-note" style={{ marginTop: -8, marginBottom: 16, maxWidth: "68ch" }}>
        Questions, feedback, or interested in using Summit TPE for your program?
      </p>
      <div className="card card-prose">
        <h2>Get in touch</h2>
        <p style={{ marginBottom: 4 }}>
          <a href="mailto:support@estrellaworks.com">support@estrellaworks.com</a>
        </p>
        <p className="section-note" style={{ marginTop: 12, marginBottom: 0 }}>
          Bug reports, a stat that looks off, a feature you wish existed, or interest in bringing this to your
          program&apos;s own transfer evaluation -- all of it is useful, and every message reaches a real
          person. Include a team or player name if you&apos;re flagging a specific number so it&apos;s easy to
          track down.
        </p>
        {/* PLACEHOLDER -- add a phone number, X/LinkedIn, or a real contact form (needs a form backend
            or an email service like Formspree/Resend -- this static page has no server-side mail sending
            wired up yet) once there's a preference for how coaches should actually reach out. */}
      </div>
    </div>
  );
}

function siteSections(sport: string): { href: string; label: string; detail: string }[] {
  return [
    {
      href: `/${sport}/tpe`,
      label: "Transfer Projection",
      detail:
        "The core transfer projector -- pick any player and any target school, set their minutes or compare up " +
        "to 3 roles (starter, sixth man, etc.) side by side, and see a full projected stat line at the new " +
        "school, with a confidence read and a real range of outcomes based on comparable real transfers.",
    },
    {
      href: `/${sport}/team-fits`,
      label: "Team Fits",
      detail:
        "The reverse direction -- tell it what a team needs (a stat category, a level, a role to fill) and it " +
        "ranks the players nationally who'd project best into that exact spot on that roster, based on next " +
        "season's likely returning roster by default.",
    },
    {
      href: `/${sport}/compare`,
      label: "Compare",
      detail: "Pick any two players, or any two teams, and see their current-season stats side by side, with the better value in each row called out.",
    },
    {
      href: `/${sport}/data`,
      label: "Data",
      detail:
        "Real leaderboards (not projections) -- top scorers, rebounders, most efficient shooters, conference " +
        "filters, who performs best against tougher competition, who's trending up as the season goes on, and " +
        "which Low-Major/Mid-Major players project as standouts at the High-Major level.",
    },
    {
      href: `/${sport}/players`,
      label: "Players",
      detail:
        "Search or browse every rostered D1 player -- sortable by any stat, with a full profile page per player " +
        "including season-by-season trends and splits against different opponent strengths.",
    },
    {
      href: `/${sport}/teams`,
      label: "Teams",
      detail:
        "Search or browse every D1 team, filterable by level and conference, with a full team profile -- roster, " +
        "schedule, and a real Stats Breakdown tab showing how the team compares to its league and its conference.",
    },
  ];
}
