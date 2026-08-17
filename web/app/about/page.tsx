import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by
// app/[sport]/about/page.tsx. Kept as a redirect (not deleted) so any old
// bookmark/external link to the pre-split URL still lands somewhere real,
// defaulting to "women" (the same fallback MobileNav.tsx uses when no
// sport segment is present in the path). See ARCHITECTURE_HOSTING_PLAN.md's
// phase 16 follow-up.
export default function AboutRedirect() {
  redirect("/women/about");
}
