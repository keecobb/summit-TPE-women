import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Team } from "@/lib/types";
import { TIERS, tierAbbrev } from "@/lib/types";
import SortableTh from "@/components/SortableTh";
import FilterForm from "@/components/FilterForm";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

type TeamWithRank = Team & { net_rank: number | null };

// Column key -> accessor, for the client-side sort below. Client-side (not
// an API param) because /teams already returns the whole filtered set in
// one call (limit 500 covers every D1 team) rather than paginating, so
// there's no correctness reason to push this down to the API the way
// /players' true pagination requires. net_rank isn't a real Team field (see
// below), so it gets its own accessor rather than living in a plain
// keyof-Team map.
const SORT_FIELDS: Record<string, (t: TeamWithRank) => string | number | null> = {
  name: (t) => t.name,
  conference: (t) => t.conference,
  tier: (t) => t.tier,
  net_rank: (t) => t.net_rank,
  current_rating: (t) => t.current_rating,
  sos: (t) => t.sos,
};

export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ search?: string; tier?: string; conference?: string; sort?: string; dir?: string }>;
}) {
  const { sport } = await params;
  const sp = await searchParams;

  // Conference is a single-select, pushed down to the API as a param --
  // /teams' `conference` param is already an exact match on one conference,
  // so there's no need to fetch the whole league and filter client-side the
  // way the earlier multiselect version did.
  //
  // allTeams (no filters) is fetched alongside the possibly-filtered `teams`
  // list specifically to compute Net Rank -- a national rank position needs
  // to be assigned across the WHOLE league first, then looked up for
  // whichever (possibly filtered) subset is on screen. Ranking only the
  // filtered rows would silently relabel e.g. the #1 Low-Major team as
  // "Net Rank 1" instead of wherever she actually sits nationally.
  const [teams, allTeams, conferences] = await Promise.all([
    apiFetch<Team[]>(`/${sport}/teams`, { params: { search: sp.search, tier: sp.tier, conference: sp.conference, limit: 500 } }),
    apiFetch<Team[]>(`/${sport}/teams`, { params: { limit: 500 }, revalidate: 60 }),
    apiFetch<string[]>(`/${sport}/conferences`),
  ]);

  // Not the NCAA's own official NET ranking -- there's no NET-specific data
  // in this pipeline. This is this site's own national rank position by
  // Current Rating (the same strength-model number the Rating column
  // already shows), computed here rather than a stored field since it just
  // has to reflect wherever a team's Current Rating currently sorts.
  const rankByTeamId = new Map<number, number>();
  [...allTeams]
    .filter((t) => t.current_rating != null)
    .sort((a, b) => b.current_rating - a.current_rating)
    .forEach((t, i) => rankByTeamId.set(t.team_id, i + 1));

  const rankedTeams: TeamWithRank[] = teams.map((t) => ({ ...t, net_rank: rankByTeamId.get(t.team_id) ?? null }));

  const sortField = sp.sort && SORT_FIELDS[sp.sort];
  if (sortField) {
    const dir = sp.dir === "asc" ? 1 : -1;
    rankedTeams.sort((a, b) => {
      const av = sortField(a), bv = sortField(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  return (
    <div>
      <h1>Teams</h1>
      <p className="subtitle">D1 teams, rated on one shared strength scale.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Rating is each team&apos;s Current Rating from the strength model -- higher is stronger, roughly
        centered on 0 across all of Division I. Net Rank is that same Rating&apos;s national rank position
        (#1 = highest-rated team in the country) -- this site&apos;s own ranking, not the NCAA&apos;s official
        NET ranking. Filter by name, Level (High-Major/Mid-Major/Low-Major), or a single conference, then click
        any column header to sort. Click a team name to open its full profile -- roster, schedule, and a Stats
        Breakdown tab comparing it to its league and conference.
      </p>

      <FilterForm className="filter-form" action={`/${sport}/teams`}>
        <div className="field">
          <label htmlFor="search">Name</label>
          <input id="search" name="search" defaultValue={sp.search ?? ""} placeholder="e.g. Baylor" />
        </div>
        <div className="field">
          <label htmlFor="tier">Level</label>
          <select id="tier" name="tier" defaultValue={sp.tier ?? ""}>
            <option value="">Any</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t} ({tierAbbrev(t)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="conference">Conference</label>
          <select id="conference" name="conference" defaultValue={sp.conference ?? ""}>
            <option value="">Any</option>
            {conferences.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          Filter
        </button>
      </FilterForm>
      {sp.conference && (
        <p className="section-note" style={{ marginTop: -8, marginBottom: 16 }}>
          Showing: {sp.conference} &middot;{" "}
          <Link href={`/${sport}/teams?${new URLSearchParams({ ...(sp.search ? { search: sp.search } : {}), ...(sp.tier ? { tier: sp.tier } : {}) }).toString()}`}>
            Clear conference filter
          </Link>
        </p>
      )}

      {rankedTeams.length === 0 ? (
        <p className="empty-state">No teams match that filter.</p>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortableTh column="name" label="Team" defaultDir="asc" />
              <SortableTh column="conference" label="Conference" defaultDir="asc" />
              <SortableTh column="tier" label="Level" defaultDir="asc" />
              <SortableTh column="net_rank" label="Net Rank" defaultDir="asc" />
              <SortableTh column="current_rating" label="Rating" />
              <SortableTh column="sos" label="SOS" />
            </tr>
          </thead>
          <tbody>
            {rankedTeams.map((t) => (
              <tr key={t.team_id}>
                <td>
                  <Link href={`/${sport}/teams/${t.team_id}`}>{t.name}</Link>
                </td>
                <td>{t.conference}</td>
                <td>
                  <span className="pill" title={t.tier}>{tierAbbrev(t.tier)}</span>
                </td>
                <td
                  title="This site's own national rank by Current Rating (the Rating column) -- not the NCAA's official NET ranking, which this pipeline doesn't compute."
                >
                  {t.net_rank ?? "--"}
                </td>
                <td>{t.current_rating?.toFixed(2)}</td>
                <td>{t.sos?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
