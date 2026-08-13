import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Team } from "@/lib/types";

const TIERS = ["P5", "Mid-Major", "Low-Major"];

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tier?: string; conference?: string }>;
}) {
  const sp = await searchParams;

  const teams = await apiFetch<Team[]>("/teams", {
    params: { search: sp.search, tier: sp.tier, conference: sp.conference, limit: 500 },
  });

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
                {t}
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
              <th>Team</th>
              <th>Conference</th>
              <th>Tier</th>
              <th>Rating</th>
              <th>SOS</th>
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
                  <span className="pill">{t.tier}</span>
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
