import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api";
import type { BatchBuildResult, BatchPlayerInput } from "@/lib/types";

// Same-origin POST proxy for the Build-a-Team page -- forwards straight to
// POST /{sport}/project/batch (the same endpoint the Batch Scouting Board
// uses, extended to accept `custom` roster slots for freshmen/coach-
// entered lines). A Route Handler, not a Server Component, because the
// page is a fully client-side interactive roster builder (add/remove
// players, edit roles, fill in freshman stat lines) rather than something
// that can be expressed as URL search params the way the simpler batch
// board is -- see BatchBuilder.tsx for that comparison. Keeps
// SUMMIT_TPE_API_KEY server-side exactly like every other proxy route
// here.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  if (sport !== "women" && sport !== "men") {
    return NextResponse.json({ error: "Missing or invalid sport." }, { status: 400 });
  }

  let body: { target_team_id: number; players: BatchPlayerInput[]; normalize_minutes?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.target_team_id || !Array.isArray(body.players) || body.players.length === 0) {
    return NextResponse.json({ error: "target_team_id and a non-empty players array are required." }, { status: 400 });
  }

  try {
    const data = await apiFetch<BatchBuildResult>(`/${sport}/project/batch`, {
      method: "POST",
      body,
      revalidate: 0,
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    throw e;
  }
}
