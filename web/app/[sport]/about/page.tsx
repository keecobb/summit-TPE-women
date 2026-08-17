import Link from "next/link";

export default async function AboutPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const sections = siteSections(sport);

  return (
    <div>
      <h1>About Summit TPE</h1>
      <p className="subtitle">The plain-language version of what this site does and how the numbers behind it work.</p>

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
          Score is only ever meant to be compared within its own sport.
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

function siteSections(sport: string): { href: string; label: string; detail: string }[] {
  return [
    {
      href: `/${sport}/tpe`,
      label: "Transfer Projection",
      detail:
        "The core transfer projector -- pick any player and any target school, set their minutes or a role " +
        "(starter, sixth man, etc.), and see a full projected stat line at the new school, with a confidence read " +
        "and a real range of outcomes based on comparable real transfers.",
    },
    {
      href: `/${sport}/team-fits`,
      label: "Team Fits",
      detail:
        "The reverse direction -- tell it what a team needs (a stat category, a level, a role to fill) and it " +
        "ranks the players nationally who'd project best into that exact spot on that roster.",
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
    {
      href: `/${sport}/glossary`,
      label: "Glossary",
      detail: "Plain-language definitions for every stat and term used across the site -- Summit Score, levels, SOS, per-40, and more.",
    },
  ];
}
