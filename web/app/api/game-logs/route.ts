import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { PlayerGameLogs } from "@/lib/types";

// Same-origin proxy so the season-by-season game log expander (a Client
// Component, since it's click-to-expand) never needs the real API key --
// see app/api/search/route.ts for the same pattern.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const playerId = searchParams.get("player_id");
  const season = searchParams.get("season");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }
  if (!playerId) return NextResponse.json({ error: "player_id required" }, { status: 400 });

  try {
    const data = await apiFetch<PlayerGameLogs>(`/${sport}/players/${playerId}/game-logs`, {
      params: { season: season ?? undefined },
      revalidate: 300,
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
