import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { TeamRoles } from "@/lib/types";

// Same-origin proxy so the Build-a-Team page (a Client Component, since
// it's an interactive multi-step roster builder) can fetch a target
// team's current roster to prefill from, without the real API key ever
// reaching the browser -- see app/api/search/route.ts for the same
// pattern. Just forwards to GET /{sport}/teams/{id}/roles, which already
// returns a classified role (Solidified Starter/Sixth Man/Role Player/
// Depth Piece) per rostered player -- exactly what's needed to prefill
// each player's role dropdown with something realistic instead of
// defaulting everyone to Auto.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const teamId = searchParams.get("team_id");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }
  if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

  try {
    const data = await apiFetch<TeamRoles>(`/${sport}/teams/${teamId}/roles`, { revalidate: 60 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
