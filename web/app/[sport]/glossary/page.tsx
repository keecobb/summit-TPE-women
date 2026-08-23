import { redirect } from "next/navigation";

// Glossary is now a tab on the merged About page (see
// app/[sport]/about/page.tsx -- About/Glossary/Contact were combined into
// one page with tabs so 3 separate nav links collapsed into 1). This route
// is kept as a redirect, not deleted, so any old bookmark/link to
// /{sport}/glossary still lands on the right content instead of a 404.
export default async function GlossaryRedirect({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  redirect(`/${sport}/about?tab=glossary`);
}
