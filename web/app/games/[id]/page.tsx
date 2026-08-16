import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by
// app/[sport]/games/[id]/page.tsx. Kept as a redirect (not deleted) so any
// old bookmark/external link to the pre-split URL still lands somewhere
// real instead of 404ing, defaulting to "women" (the same fallback
// MobileNav.tsx uses when no sport segment is present in the path). Note:
// a game_id from the old pre-split single cache isn't guaranteed to
// resolve to the same game under the new per-sport caches -- this is a
// best-effort redirect, not a guaranteed-correct one.
export default async function GameDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/women/games/${id}`);
}
