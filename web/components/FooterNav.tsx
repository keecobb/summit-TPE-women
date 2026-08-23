"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Same sport-detection logic as MobileNav.tsx/BrandLink.tsx -- kept
// separate since it renders in the footer, not the header. Defaults to
// "women" when there's no sport segment in the current path.
//
// About and Contact link to the same merged page now (About/Glossary/
// Contact were combined into one tabbed page -- see
// app/[sport]/about/page.tsx) -- Contact deep-links straight to its tab
// instead of landing on Overview and making the visitor click again.
export default function FooterNav() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const currentSport = segments[0] === "women" || segments[0] === "men" ? segments[0] : "women";

  return (
    <>
      <Link href={`/${currentSport}/about`}>About</Link> &middot;{" "}
      <Link href={`/${currentSport}/about?tab=contact`}>Contact</Link>
    </>
  );
}
