import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Player } from "@/lib/types";

const PAGE_SIZE = 25;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; position?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const offset = Number(sp.offset ?? 0) || 0;

  const players = await apiFetch<Player[]>("/players", {
    params: { search: sp.search, position: sp.position, limit: PAGE_SIZE, offset },
  });

  const hasNext = players.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  const paramsFor = (nextOffset: number) => {
    const p = new URLSearchParams();
    if (sp.search) p.set("search", sp.search);
    if (sp.position) p.set("position", sp.position);
    p.set("offset", String(nextOffset));
    return `/players?${p.toString()}`;
  };

  return (
    <div>
      <h1>Players</h1>
      <p className="subtitle">Search the current player pool. Sorted by Summit Score.</p>

      <form className="filter-form" action="/players">
        <div className="field">
          <label htmlFor="search">Name</label>
          <input id="search" name="search" defaultValue={sp.search ?? ""} placeholder="e.g. Anguera" />
        </div>
        <div className="field">
          <label htmlFor="position">Position</label>
          <input id="position" name="position" defaultValue={sp.position ?? ""} placeholder="e.g. G" />
        </div>
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>

      {players.length === 0 ? (
        <p className="empty-state">No players match that search.</p>
      ) : (
        <>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Pos</th>
                <th>Class</th>
                <th>PPG</th>
                <th>RPG</th>
                <th>APG</th>
                <th>Summit Score</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.player_id}>
                  <td>
                    <Link href={`/players/${p.player_id}`}>{p.name}</Link>
                  </td>
                  <td>{p.team_name ?? "--"}</td>
                  <td>{p.position}</td>
                  <td>{p.class_year}</td>
                  <td>{p.ppg?.toFixed(1)}</td>
                  <td>{p.rpg?.toFixed(1)}</td>
                  <td>{p.apg?.toFixed(1)}</td>
                  <td>{p.hoop_score?.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="pagination">
            {hasPrev && (
              <Link className="btn" href={paramsFor(Math.max(0, offset - PAGE_SIZE))}>
                &larr; Previous
              </Link>
            )}
            {hasNext && (
              <Link className="btn" href={paramsFor(offset + PAGE_SIZE)}>
                Next &rarr;
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
