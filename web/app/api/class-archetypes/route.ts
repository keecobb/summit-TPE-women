import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { ClassArchetypes } from "@/lib/types";

// Same-origin proxy for Team Builder's custom-entry preset picker -- see
// team-roster/route.ts for the same pattern. Forwards to GET
// /{sport}/class-archetypes, which returns real per-game averages of this
// season's actual players grouped by class year, team level, minutes-based
// archetype, and (when the sample's big enough) position, each optionally
// split into Great/Good/Average production tiers. Cached for an hour like
// the roster endpoints -- this is season-aggregate data, not something
// that changes game to game. Replaces the old freshman-only
// /api/freshman-archetypes route (phase 26) -- this endpoint's grid covers
// every class year, not just FR, so it can also ground a JUCO transfer
// (entering as SO/JR) or a lower-level transfer (entering at any class).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }

  try {
    const data = await apiFetch<ClassArchetypes>(`/${sport}/class-archetypes`, { revalidate: 3600 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
