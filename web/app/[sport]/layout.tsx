import { notFound } from "next/navigation";

// Every route under here (teams, players, compare, data, tpe, team-fits,
// conferences, games) reads its own `sport` segment and threads it into
// every apiFetch() call and internal Link -- see api.py's matching
// /{sport}/... routing and ARCHITECTURE_HOSTING_PLAN.md's "one constraint
// that decides everything else" (women's and men's players/teams must
// never be pooled together). This layout is the single choke point that
// guards against a bad/unknown sport segment (e.g. /xyz/teams) ever
// reaching a real page component and attempting a request against a
// cache file that doesn't exist -- 404s cleanly here instead.
const VALID_SPORTS = ["women", "men"] as const;

export function generateStaticParams() {
  return VALID_SPORTS.map((sport) => ({ sport }));
}

export default async function SportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (!VALID_SPORTS.includes(sport as (typeof VALID_SPORTS)[number])) {
    notFound();
  }
  return <>{children}</>;
}
