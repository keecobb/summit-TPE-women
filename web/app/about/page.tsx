export default function AboutPage() {
  return (
    <div>
      <h1>About Summit TPE</h1>
      <p className="subtitle">The plain-language version of what this site does and how the numbers behind it work.</p>

      <div className="card card-prose">
        <h2>The product</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Summit TPE puts every D1 women&apos;s basketball team on one shared strength scale, scores every player
          with a role- and opponent-adjusted Summit Score, and projects what a player&apos;s production would look
          like at a different school -- grounded in how real transfers have actually played out, not a guess. Built
          for coaches evaluating transfer targets, and for anyone who wants a clearer read on team and player
          strength than raw box scores give you.
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
          guarantee.
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
    </div>
  );
}
