import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { Player, Team } from "@/lib/types";

// Same-origin proxy for the typeahead components below. Route Handlers run
// server-side in Next.js (never shipped to the browser bundle), so this is
// safe to import lib/api.ts (server-only, holds SUMMIT_TPE_API_KEY) from --
// the browser only ever talks to this same-origin /api/search endpoint and
// never sees the real API key or the real API host.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const kind = searchParams.get("kind");
  const q = searchParams.get("q")?.trim();

  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ results: [], error: "Missing or invalid sport." }, { status: 400 });
  }
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  try {
    if (kind === "teams") {
      const teams = await apiFetch<Team[]>(`/${sport}/teams`, { params: { search: q, limit: 8 }, revalidate: 60 });
      return NextResponse.json({
        results: teams.map((t) => ({ id: t.team_id, label: t.name, sub: `${t.tier} · ${t.conference}` })),
      });
    }
    if (kind === "players") {
      const players = await apiFetch<Player[]>(`/${sport}/players`, { params: { search: q, limit: 8 }, revalidate: 60 });
      return NextResponse.json({
        results: players.map((p) => ({
          id: p.player_id,
          label: p.name,
          sub: `${p.team_name ?? "--"} · ${p.position}`,
        })),
      });
    }
    return NextResponse.json({ results: [] }, { status: 400 });
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ results: [], error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
