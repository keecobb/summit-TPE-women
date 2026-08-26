import { NextResponse } from "next/server";

// Deprecated (phase 26) -- Team Builder's preset picker now covers every
// class year (freshmen, JUCO transfers, lower-level transfers), not just
// incoming freshmen, so this endpoint was replaced by
// /api/class-archetypes (see that route for the real implementation).
// Left in place as an inert 410 instead of removed outright, since this
// file is written back to disk via the device bridge, which can't delete
// files -- feel free to delete this folder by hand.
export async function GET() {
  return NextResponse.json(
    { error: "Deprecated -- use /api/class-archetypes instead." },
    { status: 410 }
  );
}
