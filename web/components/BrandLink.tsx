"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Same sport-detection logic as MobileNav.tsx -- kept as a small separate
// client component (rather than folding into MobileNav) since it renders
// in a different spot in the header markup (the brand mark, not the nav
// links). Defaults to "women" when there's no sport segment in the
// current path, matching every other sport-detection spot on the site.
export default function BrandLink() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const currentSport = segments[0] === "women" || segments[0] === "men" ? segments[0] : "women";

  return (
    <Link href={`/${currentSport}`} className="brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- small fixed-size
          brand mark; next/image's extra runtime isn't worth it here. */}
      <img src="/summit-tpe-mark.png" alt="Summit" />
      Summit
    </Link>
  );
}
