import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import BatchBuilder from "@/components/BatchBuilder";

// Same reasoning as team-fits/page.tsx and tpe/page.tsx -- this reads the
// live SQLite cache behind the API, which can refresh at any time without
// a redeploy here.
export const dynamic = "force-dynamic";

interface SP {
  team_id?: string;
  player_id?: string | string[];
}

interface BatchPlayerResult {
  player: { id: number; name: string; position: string | null; class_year: string | null; current_team: string };
  projected: {
    minutes: number; ppg: number; rpg: number; apg: number;
    bpg: number | null; spg: number | null; topg: number | null; hoop_score: number;
  };
  confidence: string;
  extreme_mismatch: boolean;
}

interface BatchResult {
  target: { team: string; division: string; tier: string; current_rating: number };
  players: BatchPlayerResult[];
  errors: { player_id: number; error: string }[];
  combined: {
    player_count: number;
    total_minutes: number;
    total_minutes_note: string;
    ppg?: number; rpg?: number; apg?: number; bpg?: number; spg?: number; topg?: number;
  };
}

export default async function TpeBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<SP>;
}) {
  const { sport } = await params;
  const sp = await searchParams;
  const playerIds = (Array.isArray(sp.player_id) ? sp.player_id : sp.player_id ? [sp.player_id] : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  if (!sp.team_id || playerIds.length === 0) {
    return <BuilderView sport={sport} />;
  }
  return <ResultsView sport={sport} teamId={sp.team_id} playerIds={playerIds} />;
}

function BuilderView({ sport }: { sport: string }) {
  return (
    <div>
      <h1>Batch Scouting Board</h1>
      <p className="subtitle">
        Project a whole shortlist of transfer candidates onto one target team at once, with a combined total --
        for comparing several names against the same open roster spot(s) instead of running Transfer Projection
        one player at a time.
      </p>
      <BatchBuilder sport={sport} />
      <p className="section-note" style={{ marginTop: 16, maxWidth: "60ch" }}>
        Each player is projected with their own auto-resolved minutes (same default as Transfer Projection) --
        for a specific role or exact-minutes assumption per player, use{" "}
        <Link href={`/${sport}/tpe`}>Transfer Projection</Link> one at a time instead.
      </p>
    </div>
  );
}

async function ResultsView({ sport, teamId, playerIds }: { sport: string; teamId: string; playerIds: number[] }) {
  let result: BatchResult | null = null;
  let error: string | null = null;
  try {
    result = await apiFetch<BatchResult>(`/${sport}/project/batch`, {
      method: "POST",
      body: { target_team_id: Number(teamId), players: playerIds.map((player_id) => ({ player_id })) },
      revalidate: 0,
    });
  } catch (e) {
    if (e instanceof ApiError) error = e.message;
    else throw e;
  }

  return (
    <div>
      <h1>Batch Scouting Board</h1>
      {error && <div className="error-box">{error}</div>}

      {result && (
        <>
          <p className="subtitle">
            {result.players.length} candidate{result.players.length === 1 ? "" : "s"} projected onto{" "}
            <strong>{result.target.team}</strong> ({result.target.tier}, {result.target.current_rating.toFixed(1)}{" "}
            rating).
          </p>

          {result.errors.length > 0 && (
            <div className="error-box" style={{ marginBottom: 16 }}>
              {result.errors.length} candidate{result.errors.length === 1 ? "" : "s"} couldn&apos;t be projected:{" "}
              {result.errors.map((e) => e.error).join(" ")}
            </div>
          )}

          <div className="card">
            <h2>Combined Total</h2>
            <p className="section-note">{result.combined.total_minutes_note}</p>
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="value">{result.combined.total_minutes}</div>
                <div className="label">Total Minutes</div>
              </div>
              {(["ppg", "rpg", "apg", "bpg", "spg", "topg"] as const).map((k) =>
                result!.combined[k] != null ? (
                  <div className="stat-tile" key={k}>
                    <div className="value">{result!.combined[k]}</div>
                    <div className="label">{k.toUpperCase()}</div>
                  </div>
                ) : null
              )}
            </div>
          </div>

          <div className="card">
            <h2>Candidates</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Current team</th>
                    <th>Class</th>
                    <th>Proj. minutes</th>
                    <th>Proj. line</th>
                    <th>Proj. Summit Score</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.players.map((p) => (
                    <tr key={p.player.id}>
                      <td>
                        <Link href={`/${sport}/players/${p.player.id}`}>{p.player.name}</Link>
                      </td>
                      <td>{p.player.current_team}</td>
                      <td>{p.player.class_year ?? "--"}</td>
                      <td>{p.projected.minutes.toFixed(1)}</td>
                      <td>
                        {p.projected.ppg.toFixed(1)} ppg, {p.projected.rpg.toFixed(1)} rpg, {p.projected.apg.toFixed(1)} apg
                      </td>
                      <td>{p.projected.hoop_score.toFixed(1)}</td>
                      <td>
                        <span className={p.extreme_mismatch ? "pill pill-warn" : "pill pill-good"}>{p.confidence}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href={`/${sport}/tpe/batch`}>&larr; Start a new board</Link>
      </p>
    </div>
  );
}
