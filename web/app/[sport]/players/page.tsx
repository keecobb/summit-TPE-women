import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { Player } from "@/lib/types";
import SortableTh from "@/components/SortableTh";
import FilterForm from "@/components/FilterForm";
import Pagination from "@/components/Pagination";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const CLASS_YEARS = ["FR", "SO", "JR", "SR"];
const POSITIONS = ["G", "F", "C"];

interface SP {
  search?: string;
  position?: string;
  class_year?: string;
  page?: string;
  size?: string;
  sort?: string;
  dir?: string;
}

export default async function PlayersPage({ params, searchParams }: { params: Promise<{ sport: string }>; searchParams: Promise<SP> }) {
  const { sport } = await params;
  const sp = await searchParams;

  const size = PAGE_SIZE_OPTIONS.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * size;

  const filterParams = { search: sp.search, position: sp.position, class_year: sp.class_year };

  const [players, countResult] = await Promise.all([
    apiFetch<Player[]>(`/${sport}/players`, {
      params: { ...filterParams, limit: size, offset, sort: sp.sort, order: sp.dir },
    }),
    apiFetch<{ total: number }>(`/${sport}/players/count`, { params: filterParams }),
  ]);

  const total = countResult.total;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const anyThin = players.some((p) => !!p.thin_sample);
  const anyZeroGames = players.some((p) => (p.games ?? 0) === 0);

  const hrefFor = (nextPage: number, nextSize: number = size) => {
    const p = new URLSearchParams();
    if (sp.search) p.set("search", sp.search);
    if (sp.position) p.set("position", sp.position);
    if (sp.class_year) p.set("class_year", sp.class_year);
    if (sp.sort) p.set("sort", sp.sort);
    if (sp.dir) p.set("dir", sp.dir);
    if (nextSize !== DEFAULT_PAGE_SIZE) p.set("size", String(nextSize));
    if (nextPage > 1) p.set("page", String(nextPage));
    const qs = p.toString();
    return qs ? `/${sport}/players?${qs}` : `/${sport}/players`;
  };

  return (
    <div>
      <h1>Players</h1>
      <p className="subtitle">Search the current player pool. Sorted by Summit Score.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Filter by name, position, and/or class, then click any column header to sort by that stat instead.
        Click a player&apos;s name to open their full profile -- season splits, trajectory, and (once they
        have enough games on record) their best games of the year.
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
        {/* Carries the current page size through a filter submit -- FilterForm
            only serializes its own fields, so without this hidden field a
            visitor who picked "50 per page" would get silently bumped back
            to the 10-per-page default the next time they searched/filtered. */}
        <input type="hidden" name="size" value={size} />
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
              findable/on their team&apos;s roster, just nothing to average.
            </p>
          )}

          <div className="pagination-bar">
            <p className="section-note" style={{ margin: 0 }}>
              Showing {total === 0 ? 0 : offset + 1}&ndash;{Math.min(offset + players.length, total)} of {total}
              &nbsp;&middot;&nbsp; Show:{" "}
              {PAGE_SIZE_OPTIONS.map((opt, i) => (
                <span key={opt}>
                  {i > 0 && " / "}
                  {opt === size ? (
                    <strong>{opt}</strong>
                  ) : (
                    <Link href={hrefFor(1, opt)}>{opt}</Link>
                  )}
                </span>
              ))}
            </p>
            <Pagination page={page} totalPages={totalPages} buildHref={(p) => hrefFor(p)} />
          </div>
        </>
      )}
    </div>
  );
}
