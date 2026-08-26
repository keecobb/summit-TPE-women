import TeamBuilder from "@/components/TeamBuilder";

export default async function TeamBuilderPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  return (
    <div>
      <h1>Build-a-Team</h1>
      <p className="subtitle">
        Assemble a hypothetical roster and see how it would project as a team -- start from a real team&apos;s
        current players, swap in anyone from the transfer pool, and fill open spots with a freeform entry for an
        incoming freshman or anyone else with no season on record yet.
      </p>
      <TeamBuilder sport={sport} />
      <p className="section-note" style={{ marginTop: 20, maxWidth: "70ch" }}>
        The combined team total is a plain sum of each player&apos;s own projection (or, for a custom entry, the
        coach-entered line) -- it doesn&apos;t re-solve a team rating with this exact roster inserted, so treat it
        as &quot;what this group of players would individually put up in this role mix,&quot; not a finalized team
        rating. Custom entries (freshmen, etc.) carry no Summit Score and no model-based range -- they&apos;re
        exactly what was typed in, clearly marked throughout.
      </p>
    </div>
  );
}
