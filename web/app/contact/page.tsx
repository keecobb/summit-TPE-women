import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by the
// Contact tab on app/[sport]/about/page.tsx (About/Glossary/Contact were
// later merged into one tabbed page). Kept as a redirect (not deleted) so
// any old bookmark/external link to the pre-split URL still lands
// somewhere real, defaulting to "women" (the same fallback MobileNav.tsx
// uses when no sport segment is present in the path). See
// ARCHITECTURE_HOSTING_PLAN.md's phase 16 and phase 22 follow-ups.
export default function ContactRedirect() {
  redirect("/women/about?tab=contact");
}
