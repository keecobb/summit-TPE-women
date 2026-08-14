import Link from "next/link";
import { apiFetch } from "@/lib/api";

// Forces a fresh fetch on every request instead of risking Next's Data
// Cache/Full Route Cache treating this route as static (see
// ARCHITECTURE_HOSTING_PLAN.md's caching-fix notes for the full writeup).
export const dynamic = "force-dynamic";

export default async function ConferencesIndexPage() {
  const conferences = await apiFetch<string[]>("/conferences");

  return (
    <div>
      <h1>Conferences</h1>
      <p className="subtitle">Standings for every conference on record -- overall and conference-only records.</p>
      <p className="section-note" style={{ marginTop: -20, marginBottom: 20, maxWidth: "68ch" }}>
        Pick a conference below to see every team's overall and conference-only win/loss record, sorted by
        conference win percentage -- real results this season, not a rating-based projection.
      </p>

      <div className="card">
        <div className="card-grid card-grid-3">
          {conferences.map((c) => (
            <Link key={c} href={`/conferences/${encodeURIComponent(c)}`} className="btn" style={{ textAlign: "center" }}>
              {c}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
