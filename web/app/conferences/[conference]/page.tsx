import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import type { ConferenceStandings } from "@/lib/types";

export default async function ConferenceStandingsPage({ params }: { params: Promise<{ conference: string }> }) {
  const { conference } = await params;
  const name = decodeURIComponent(conference);

  let standings: ConferenceStandings;
  try {
    standings = await apiFetch<ConferenceStandings>(`/conferences/${encodeURIComponent(name)}/standings`, {
      revalidate: 60,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div>
      <h1>{name} Standings</h1>
      <p className="subtitle">{standings.season} season &middot; sorted by conference win percentage.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Rating is each team&apos;s Current Rating from the strength model, shown for reference -- these
        standings themselves are plain real win/loss records, not rating-based. Click a team to open its full
        profile.
      </p>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Conf. Record</th>
                <th>Conf. Win %</th>
                <th>Overall Record</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {standings.teams.map((t, i) => (
                <tr key={t.team_id}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/teams/${t.team_id}`}>{t.name}</Link>
                  </td>
                  <td>
                    {t.conference_wins}-{t.conference_losses}
                  </td>
                  <td>{t.conference_win_pct != null ? (t.conference_win_pct * 100).toFixed(1) + "%" : "--"}</td>
                  <td>
                    {t.wins}-{t.losses}
                  </td>
                  <td>{t.current_rating?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link href="/conferences">&larr; All conferences</Link>
      </p>
    </div>
  );
}
