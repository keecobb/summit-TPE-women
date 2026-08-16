import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Player } from "@/lib/types";
import SortableTh from "@/components/SortableTh";
import FilterForm from "@/components/FilterForm";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const CLASS_YEARS = ["FR", "SO", "JR", "SR", "GR"];
const POSITIONS = ["G", "F", "C"];

// 4'6" (54") to 7'0" (84") in 1" steps -- covers every real height on
// record with room to spare, shown as a plain feet/inches label so a
// visitor doesn't have to think in raw inches to use the filter.
const HEIGHT_OPTIONS = Array.from({ length: 84 - 54 + 1 }, (_, i) => {
  const inches = 54 + i;
  return { value: inches, label: `${Math.floor(inches / 12)}' ${inches % 12}"` };
});

interface SP {
  search?: string;
  position?: string;
  class_year?: string;
  min_height_in?: string;
  max_height_in?: string;
  offset?: string;
  sort?: string;
  dir?: string;
}

export default async function PlayersPage({ params, searchParams }: { params: Promise<{ sport: string }>; searchParams: Promise<SP> }) {
  const { sport } = await params;
  const sp = await searchParams;
  const offset = Number(sp.offset ?? 0) || 0;

  const players = await apiFetch<Player[]>(`/${sport}/players`, {
    params: {
      search: sp.search, position: sp.position, class_year: sp.class_year,
      min_height_in: sp.min_height_in, max_height_in: sp.max_height_in,
      limit: PAGE_SIZE, offset, sort: sp.sort, order: sp.dir,
    },
  });

  const hasNext = players.length === PAGE_SIZE;
  const hasPrev = offset > 0;
  const anyThin = players.some((p) => !!p.thin_sample);
  const anyZeroGames = players.some((p) => (p.games ?? 0) === 0);

  const paramsFor = (nextOffset: number) => {
    const p = new URLSearchParams();
    if (sp.search) p.set("search", sp.search);
    if (sp.position) p.set("position", sp.position);
    if (sp.class_year) p.set("class_year", sp.class_year);
    if (sp.min_height_in) p.set("min_height_in", sp.min_height_in);
    if (sp.max_height_in) p.set("max_height_in", sp.max_height_in);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.dir) p.set("dir", sp.dir);
    p.set("offset", String(nextOffset));
    return `/${sport}/players?${p.toString()}`;
  };

  return (
    <div>
      <h1>Players</h1>
      <p className="subtitle">Search the current player pool. Sorted by Summit Score.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Filter by name, position, class, and/or a height range, then click any column header to sort by that
        stat instead. Click a player&apos;s name to open her full profile -- season splits, trajectory, and
        (once she has enough games on record) her best games of the year.
      </p>

      <FilterForm className="filter-form" action={`/${sport}/players`}>
        <div className="field">
          <label htmlFor="search">Name</label>
          <input id="search" name="search" defaultValue={sp.search ?? ""} placeholder="e.g. Anguera" />
        </div>
        <div className="field">
          <label htmlFor="position">Position</label>
          <select id="position" name="position" defaultValue={sp.position ?? ""}>
            <option value="">Any</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="class_year">Class</label>
          <select id="class_year" name="class_year" defaultValue={sp.class_year ?? ""}>
            <option value="">Any</option>
            {CLASS_YEARS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="min_height_in">Min. height</label>
          <select id="min_height_in" name="min_height_in" defaultValue={sp.min_height_in ?? ""}>
            <option value="">Any</option>
            {HEIGHT_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="max_height_in">Max. height</label>
          <select id="max_height_in" name="max_height_in" defaultValue={sp.max_height_in ?? ""}>
            <option value="">Any</option>
            {HEIGHT_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </FilterForm>

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
                <SortableTh column="height" label="Height" defaultDir="asc" />
                <SortableTh column="class_year" label="Class" defaultDir="asc" />
                <SortableTh column="ppg" label="PPG" />
                <SortableTh column="rpg" label="RPG" />
                <SortableTh column="apg" label="APG" />
                <SortableTh column="hoop_score" label="Summit Score" />
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const zeroGames = (p.games ?? 0) === 0;
                return (
                  <tr key={p.player_id}>
                    <td>
                      <Link href={`/${sport}/players/${p.player_id}`}>{p.name}</Link>
                    </td>
                    <td>{p.team_name ?? "--"}</td>
                    <td>{p.position}</td>
                    <td>{p.height ?? "--"}</td>
                    <td>{p.class_year}</td>
                    {zeroGames ? (
                      <td colSpan={4} className="section-note">
                        Did not log any stats this season
                      </td>
                    ) : (
                      <>
                        <td>{p.ppg?.toFixed(1) ?? "N/A"}</td>
                        <td>{p.rpg?.toFixed(1) ?? "N/A"}</td>
                        <td>{p.apg?.toFixed(1) ?? "N/A"}</td>
                        <td>
                          {p.hoop_score != null ? p.hoop_score.toFixed(1) : "N/A"}
                          {p.thin_sample ? (
                            <span className="pill pill-warn" style={{ marginLeft: 6 }} title="Limited sample this season -- below the games/minutes floor for a full profile.">
                              limited
                            </span>
                          ) : null}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
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
          {anyZeroGames && (
            <p className="section-note">
              &quot;Did not log any stats this season&quot; = on the roster but no games/box-score data on
              record this season (redshirt, season-long injury, never got off the bench, etc.) -- still
              findable/on her team&apos;s roster, just nothing to average.
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
