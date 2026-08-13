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

  const teams = await apiFetch<Team[]>("/teams", {
    params: { search: sp.search, tier: sp.tier, conference: sp.conference, limit: 500 },
  });

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

      <form className="filter-form" action="/teams">
        <div className="field">
          <label htmlFor="search">Name</label>
          <input id="search" name="search" defaultValue={sp.search ?? ""} placeholder="e.g. Baylor" />
        </div>
        <div className="field">
          <label htmlFor="tier">Tier</label>
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
          <input id="conference" name="conference" defaultValue={sp.conference ?? ""} placeholder="e.g. Southland" />
        </div>
        <button className="btn btn-primary" type="submit">
          Filter
        </button>
      </form>

      {teams.length === 0 ? (
        <p className="empty-state">No teams match that filter.</p>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortableTh column="name" label="Team" defaultDir="asc" />
              <SortableTh column="conference" label="Conference" defaultDir="asc" />
              <SortableTh column="tier" label="Tier" defaultDir="asc" />
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
