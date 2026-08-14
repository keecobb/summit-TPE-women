import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Team } from "@/lib/types";
import { TIERS, tierAbbrev } from "@/lib/types";
import SortableTh from "@/components/SortableTh";

// Column key -> Team field, for the client-side sort below. Client-side
// (not an API param) because /teams already returns the whole filtered set
// in one call (limit 500 covers every D1 team) rather than paginating, so
// there's no correctness reason to push this down to the API the way
// /players' true pagination requires.
const SORT_FIELDS: Record<string, keyof Team> = {
  name: "name", conference: "conference", tier: "tier", current_rating: "current_rating", sos: "sos",
};

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tier?: string; conference?: string; sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;

  // Conference is a single-select, pushed down to the API as a param --
  // /teams' `conference` param is already an exact match on one conference,
  // so there's no need to fetch the whole league and filter client-side the
  // way the earlier multiselect version did.
  const [teams, conferences] = await Promise.all([
    apiFetch<Team[]>("/teams", { params: { search: sp.search, tier: sp.tier, conference: sp.conference, limit: 500 } }),
    apiFetch<string[]>("/conferences"),
  ]);

  const sortField = sp.sort && SORT_FIELDS[sp.sort];
  if (sortField) {
    const dir = sp.dir === "asc" ? 1 : -1;
    teams.sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
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
        centered on 0 across all of Division I. Filter by name, Level (High-Major/Mid-Major/Low-Major), or a
        single conference, then click any column header to sort. Click a team name to open its full profile
        -- roster, schedule, and a Stats Breakdown tab comparing it to its league and conference.
      </p>

      <form className="filter-form" action="/teams">
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
      </form>
      {sp.conference && (
        <p className="section-note" style={{ marginTop: -8, marginBottom: 16 }}>
          Showing: {sp.conference} &middot;{" "}
          <Link href={`/teams?${new URLSearchParams({ ...(sp.search ? { search: sp.search } : {}), ...(sp.tier ? { tier: sp.tier } : {}) }).toString()}`}>
            Clear conference filter
          </Link>
        </p>
      )}

      {teams.length === 0 ? (
        <p className="empty-state">No teams match that filter.</p>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortableTh column="name" label="Team" defaultDir="asc" />
              <SortableTh column="conference" label="Conference" defaultDir="asc" />
              <SortableTh column="tier" label="Level" defaultDir="asc" />
              <SortableTh column="current_rating" label="Rating" />
              <SortableTh column="sos" label="SOS" />
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.team_id}>
                <td>
                  <Link href={`/teams/${t.team_id}`}>{t.name}</Link>
                </td>
                <td>{t.conference}</td>
                <td>
                  <span className="pill" title={t.tier}>{tierAbbrev(t.tier)}</span>
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
