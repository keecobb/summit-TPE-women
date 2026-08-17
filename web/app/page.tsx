import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by
// app/[sport]/page.tsx. Kept as a redirect (not deleted) so any old
// bookmark/external link to the pre-split URL still lands somewhere real
// instead of showing stale women's-only copy, defaulting to "women" (the
// same fallback MobileNav.tsx uses when no sport segment is present in
// the path). See ARCHITECTURE_HOSTING_PLAN.md's phase 16 follow-up: this
// bare route used to be the ONLY way to reach "Home," and since it had no
// sport segment, navigating here reset the nav's sport context back to
// women's even if you were mid-browse on the men's side.
export default function HomeRedirect() {
  redirect("/women");
}
