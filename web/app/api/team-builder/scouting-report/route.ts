import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { ScoutingReport } from "@/lib/types";

// Same-origin POST proxy for Team Builder's scouting report -- forwards to
// POST /{sport}/team-builder/scouting-report?target_team_id=..., passing
// through the `combined` block Team Builder already has on screen from its
// most recent /api/team-builder (project/batch) response. See
// team_builder_scouting_report()'s docstring in projection.py for what
// this returns and what's an estimate vs. real data.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const targetTeamId = searchParams.get("target_team_id");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }
  if (!targetTeamId) {
    return NextResponse.json({ error: "target_team_id is required." }, { status: 400 });
  }

  let combined: unknown;
  try {
    combined = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const data = await apiFetch<ScoutingReport>(
      `/${sport}/team-builder/scouting-report`,
      { method: "POST", params: { target_team_id: targetTeamId }, body: combined, revalidate: 0 }
    );
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
