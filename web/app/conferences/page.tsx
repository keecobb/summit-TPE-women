import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by
// app/[sport]/conferences/page.tsx. Kept as a redirect (not deleted) so
// any old bookmark/external link to the pre-split URL still lands
// somewhere real instead of 404ing, defaulting to "women" (the same
// fallback MobileNav.tsx uses when no sport segment is present in the path).
export default function ConferencesRedirect() {
  redirect("/women/conferences");
}
