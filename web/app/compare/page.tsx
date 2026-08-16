import { redirect } from "next/navigation";

// This route predates the men's/women's split -- superseded by
// app/[sport]/compare/page.tsx. Kept as a redirect (not deleted) so any
// old bookmark/external link to the pre-split URL still lands somewhere
// real instead of 404ing, defaulting to "women" (the same fallback
// MobileNav.tsx uses when no sport segment is present in the path).
export default async function CompareRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, v);
  }
  const suffix = qs.toString();
  redirect(`/women/compare${suffix ? `?${suffix}` : ""}`);
}
