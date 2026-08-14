import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import type { PlayerDetail } from "@/lib/types";
import { tierAbbrev } from "@/lib/types";
import Typeahead from "@/components/Typeahead";

interface SP {
  player1?: string;
  player2?: string;
}

// Stat rows shown in the comparison table -- [key on PlayerDetail, label,
// display formatter]. ts_pct/fg_pct come back as raw 0-1 fractions on
// /players/{id} (unlike the list endpoint), so those two get *100 here.
const ROWS: { key: keyof PlayerDetail; label: string; fmt?: (v: number) => string }[] = [
  { key: "games", label: "GP", fmt: (v) => v.toFixed(0) },
  { key: "avg_minutes", label: "MPG" },
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "topg", label: "TOPG" },
  { key: "ts_pct", label: "TS%", fmt: (v) => (v * 100).toFixed(1) },
  { key: "fg_pct", label: "FG%", fmt: (v) => (v * 100).toFixed(1) },
  { key: "per40_pts", label: "Pts/40" },
  { key: "per40_reb", label: "Reb/40" },
  { key: "per40_ast", label: "Ast/40" },
  { key: "hoop_score", label: "Summit Score" },
];

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  if (!sp.player1 || !sp.player2) {
    return <PickerView sp={sp} />;
  }

  let p1: PlayerDetail, p2: PlayerDetail;
  try {
    [p1, p2] = await Promise.all([
      apiFetch<PlayerDetail>(`/players/${sp.player1}`, { revalidate: 60 }),
      apiFetch<PlayerDetail>(`/players/${sp.player2}`, { revalidate: 60 }),
    ]);
  } catch (e) {
    if (e instanceof ApiError) {
      return (
        <div>
          <h1>Compare Players</h1>
          <div className="error-box">{e.message}</div>
          <p style={{ marginTop: 20 }}>
            <Link href="/compare">&larr; Start over</Link>
          </p>
        </div>
      );
    }
    throw e;
  }

  return (
    <div>
      <h1>Compare Players</h1>
      <p className="subtitle">
        {p1.season} season, per-game unless noted. Higher is bolded for every row (lower is better for TOPG, not
        bolded specially -- read that one the other way).
      </p>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Stat</th>
                <th>
                  <Link href={`/players/${p1.player_id}`}>{p1.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {p1.team_name} &middot; {tierAbbrev(p1.team_tier ?? p1.tier)} &middot; {p1.position}, {p1.class_year}
                    {p1.thin_sample ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>limited</span> : null}
                  </div>
                </th>
                <th>
                  <Link href={`/players/${p2.player_id}`}>{p2.name}</Link>
                  <div className="label" style={{ marginTop: 2 }}>
                    {p2.team_name} &middot; {tierAbbrev(p2.team_tier ?? p2.tier)} &middot; {p2.position}, {p2.class_year}
                    {p2.thin_sample ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>limited</span> : null}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const v1 = p1[r.key] as number | null | undefined;
                const v2 = p2[r.key] as number | null | undefined;
                const lowerBetter = r.key === "topg";
                const better1 = v1 != null && v2 != null && (lowerBetter ? v1 < v2 : v1 > v2);
                const better2 = v1 != null && v2 != null && (lowerBetter ? v2 < v1 : v2 > v1);
                const fmt = r.fmt ?? ((v: number) => v.toFixed(1));
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td style={better1 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v1 != null ? fmt(v1) : "--"}
                    </td>
                    <td style={better2 ? { fontWeight: 700, color: "var(--accent)" } : undefined}>
                      {v2 != null ? fmt(v2) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link href="/compare">&larr; Compare different players</Link>
      </p>
    </div>
  );
}

async function PickerView({ sp }: { sp: SP }) {
  let player1: PlayerDetail | null = null;
  if (sp.player1) {
    try {
      player1 = await apiFetch<PlayerDetail>(`/players/${sp.player1}`, { revalidate: 60 });
    } catch {
      // ignore -- fall through to letting them pick again
    }
  }

  return (
    <div>
      <h1>Compare Players</h1>
      <p className="subtitle">Pick two players to see their current-season stats side by side.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Search by name for each player, pick from the dropdown, then submit -- every row is real production
        this season, with the better value in each row bolded (lower is better for TOPG only, read that row
        the other way around).
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <form action="/compare">
          <div className="field">
            <label htmlFor="player1-search">Player 1</label>
            <Typeahead
              kind="players"
              inputId="player1-search"
              placeholder="e.g. Bruna Anguera"
              mode="select"
              hiddenName="player1"
              required
              defaultSelectedId={player1?.player_id}
              defaultSelectedLabel={player1?.name}
            />
          </div>
          <div className="field">
            <label htmlFor="player2-search">Player 2</label>
            <Typeahead
              kind="players"
              inputId="player2-search"
              placeholder="e.g. Audi Crooks"
              mode="select"
              hiddenName="player2"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Compare
          </button>
        </form>
      </div>
    </div>
  );
}
