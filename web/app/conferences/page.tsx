import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default async function ConferencesIndexPage() {
  const conferences = await apiFetch<string[]>("/conferences");

  return (
    <div>
      <h1>Conferences</h1>
      <p className="subtitle">Standings for every conference on record -- overall and conference-only records.</p>

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
