import TeamBuilder from "@/components/TeamBuilder";

export default async function TeamBuilderPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  return (
    <div>
      <h1>Team Builder</h1>
      <p className="subtitle">
        Assemble a hypothetical 2026-27 roster and see how it would project as a team -- start from a real
        team&apos;s current players, swap in anyone from the transfer pool, and fill open spots with a freshman,
        JUCO transfer, or lower-level transfer entry for anyone with no 2025-26 season on record yet. Projections
        lean on each player&apos;s 2025-26 season plus any earlier seasons on record.
      </p>
      <TeamBuilder sport={sport} />
      <p className="section-note" style={{ marginTop: 20, maxWidth: "70ch" }}>
        The combined team total normalizes every unlocked player&apos;s minutes so the roster lands at a realistic
        200 combined minutes per game (5 players x 40 minutes), the same way a real rotation has to add up --
        it&apos;s still a sum of each player&apos;s own individual projection (or, for a custom entry, the
        coach-entered or preset-based line), not a re-solved team rating. Custom entries (freshmen, transfers,
        etc.) carry no Summit Score and no model-based range -- they&apos;re either exactly what was typed in or
        drawn from a real production-tier preset, clearly marked throughout.
      </p>
    </div>
  );
}
