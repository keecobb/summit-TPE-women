"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

// Sport-scoped sections live under /{sport}/... (see app/[sport]/layout.tsx
// and ARCHITECTURE_HOSTING_PLAN.md's rollout plan). These are the top-level
// listing pages that are safe to jump straight to when switching sport mid-
// browse -- unlike a /teams/{id} or /players/{id} detail page, a bare
// listing page has no sport-specific ID embedded in the path, so it's never
// a dead link in the other sport.
const SPORT_SECTIONS = ["tpe", "team-fits", "compare", "data", "players", "teams", "conferences"] as const;

const LINKS: { section: (typeof SPORT_SECTIONS)[number]; label: string }[] = [
  { section: "tpe", label: "Transfer Projection" },
  { section: "team-fits", label: "Team Fits" },
  { section: "compare", label: "Compare" },
  { section: "data", label: "Data" },
  { section: "players", label: "Players" },
  { section: "teams", label: "Teams" },
  // { section: "conferences", label: "Conferences" }, // hidden for now -- pages still live, just unlinked
];

const STATIC_LINKS: { href: string; label: string }[] = [
  { href: "/glossary", label: "Glossary" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Client component only for the small bit of interactivity (open/close on
// small screens, and now the sport toggle) -- the links themselves are
// still plain <Link>s, so this doesn't change how the rest of the site
// fetches data server-side.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Path shape is either /{sport}/{section}/... (sport-scoped) or a static
  // top-level route like /about that has no sport segment at all. Default
  // to "women" when there's no sport segment in the current path (matches
  // the home page staying hardcoded to women's, per
  // ARCHITECTURE_HOSTING_PLAN.md), so the nav always has a sensible sport
  // to link into rather than a broken/undefined one.
  const segments = pathname.split("/").filter(Boolean);
  const currentSport = segments[0] === "women" || segments[0] === "men" ? segments[0] : "women";
  const otherSport = currentSport === "women" ? "men" : "women";

  // Switching sport mid-browse: preserve the current section if we're on
  // that section's own bare listing page (exactly /{sport}/{section}, no
  // further path segments) -- e.g. /women/teams -> /men/teams is always a
  // valid page. Anything deeper (a specific team/player/game id, which
  // isn't shared across sports -- see ARCHITECTURE_HOSTING_PLAN.md's
  // separate-cache-per-sport constraint) falls back to that other sport's
  // Teams listing instead of risking a 404 or, worse, silently landing on
  // an unrelated team/player that happens to reuse the same numeric id.
  const currentSection = segments[1];
  const onBareSectionPage = segments.length === 2 && SPORT_SECTIONS.includes(currentSection as (typeof SPORT_SECTIONS)[number]);
  const otherSportHref = onBareSectionPage ? `/${otherSport}/${currentSection}` : `/${otherSport}/teams`;

  return (
    <>
      <div className={`links${open ? " open" : ""}`}>
        {LINKS.map((l) => (
          <Link key={l.section} href={`/${currentSport}/${l.section}`} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
        {STATIC_LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="sport-toggle" role="group" aria-label="Choose sport">
        <Link
          href={currentSport === "women" ? pathname : otherSportHref}
          className={`sport-toggle-option${currentSport === "women" ? " active" : ""}`}
          aria-current={currentSport === "women" ? "page" : undefined}
        >
          Women&apos;s
        </Link>
        <Link
          href={currentSport === "men" ? pathname : otherSportHref}
          className={`sport-toggle-option${currentSport === "men" ? " active" : ""}`}
          aria-current={currentSport === "men" ? "page" : undefined}
        >
          Men&apos;s
        </Link>
      </div>
      <ThemeToggle />
      <button
        type="button"
        className="nav-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        {open ? "✕" : "☰"}
      </button>
    </>
  );
}
