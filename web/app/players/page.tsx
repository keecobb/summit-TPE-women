import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Player } from "@/lib/types";
import SortableTh from "@/components/SortableTh";

const PAGE_SIZE = 25;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; position?: string; offset?: string; sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const offset = Number(sp.offset ?? 0) || 0;

  const players = await apiFetch<Player[]>("/players", {
    params: { search: sp.search, position: sp.position, limit: PAGE_SIZE, offset, sort: sp.sort, order: sp.dir },
  });

  const hasNext = players.length === PAGE_SIZE;
  const hasPrev = offset > 0;
  const anyThin = players.some((p) => !!p.thin_sample);

  const paramsFor = (nextOffset: number) => {
    const p = new URLSearchParams();
    if (sp.search) p.set("search", sp.search);
    if (sp.position) p.set("position", sp.position);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.dir) p.set("dir", sp.dir);
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
                <SortableTh column="name" label="Name" defaultDir="asc" />
                <SortableTh column="team_name" label="Team" defaultDir="asc" />
                <SortableTh column="position" label="Pos" defaultDir="asc" />
                <th>Height</th>
                <SortableTh column="class_year" label="Class" defaultDir="asc" />
                <SortableTh column="ppg" label="PPG" />
                <SortableTh column="rpg" label="RPG" />
                <SortableTh column="apg" label="APG" />
                <SortableTh column="hoop_score" label="Summit Score" />
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
                  <td>{p.height ?? "--"}</td>
                  <td>{p.class_year}</td>
                  <td>{p.ppg?.toFixed(1)}</td>
                  <td>{p.rpg?.toFixed(1)}</td>
                  <td>{p.apg?.toFixed(1)}</td>
                  <td>
                    {p.hoop_score?.toFixed(1)}
                    {p.thin_sample ? (
                      <span className="pill pill-warn" style={{ marginLeft: 6 }} title="Limited sample this season -- below the games/minutes floor for a full profile.">
                        limited
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {anyThin && (
            <p className="section-note">
              <span className="pill pill-warn">limited</span> = fewer than 5 games or 100 total minutes this
              season (bench role, injury, etc). Still a real player on record -- just a small, noisier sample,
              so treat the Summit Score with extra caution.
            </p>
          )}

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
