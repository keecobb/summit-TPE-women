import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { FreshmanArchetypes } from "@/lib/types";

// Same-origin proxy for the Build-a-Team page's freshman/custom-entry
// preset picker -- see team-roster/route.ts for the same pattern. Forwards
// to GET /{sport}/freshman-archetypes, which returns real per-game
// averages of this season's actual freshmen grouped by team level (High-
// Major/Mid-Major/Low-Major) and by minutes-based archetype (Day 1
// Starter/Role Player/Depth Piece). Cached for an hour like the roster
// endpoints -- this is season-aggregate data, not something that changes
// game to game.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }

  try {
    const data = await apiFetch<FreshmanArchetypes>(`/${sport}/freshman-archetypes`, { revalidate: 3600 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
