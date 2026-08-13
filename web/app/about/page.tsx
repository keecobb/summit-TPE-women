export default function AboutPage() {
  return (
    <div>
      <h1>About Summit TPE</h1>

      <div className="card">
        <h2>The product</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          {/* PLACEHOLDER -- replace with the real product story: what problem this solves for coaches,
              what makes the projection model trustworthy (real-transfer calibration, opponent-adjusted
              ratings), and who it's for. */}
          Summit TPE puts every D1 and D2 women&apos;s basketball team on one shared strength scale, scores every
          player with a role- and opponent-adjusted Hoop Score, and projects what a player&apos;s production would
          look like at a different school -- grounded in how real transfers have actually played out, not a
          guess. Built for coaches evaluating transfer targets, and for anyone who wants a clearer read on team
          and player strength than raw box scores give you.
        </p>
      </div>

      <div className="card">
        <h2>How the numbers work</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Team strength ratings come from a margin-of-victory network run across every game, D1 and D2 together,
          so a mismatch a few links removed still informs a team&apos;s rating. Hoop Score normalizes each
          player&apos;s per-40 production for role and opponent strength. Transfer projections use a model fit
          directly against real transfers found in the underlying data -- not hand-picked constants -- and every
          projection ships with a real percentile range, not just a single number, so it reads as an honest
          estimate rather than a guarantee.
        </p>
      </div>

      <div className="card">
        <h2>About the founder</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          {/* PLACEHOLDER -- replace with a real bio: background, why this got built, relevant
              basketball/data experience. */}
          Summit TPE is built and maintained by Larry Rachal. Send a real bio and this section is a quick swap
          in <code>app/about/page.tsx</code>.
        </p>
      </div>
    </div>
  );
}
