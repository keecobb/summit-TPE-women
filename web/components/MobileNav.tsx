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
// "about" (which now also covers Glossary and Contact as tabs -- see
// app/[sport]/about/page.tsx) is content-identical across sports but still
// lives under the [sport]/ segment so the URL always carries the current
// sport -- without that, navigating to it reset the nav's sport context
// back to women's on your next click (see ARCHITECTURE_HOSTING_PLAN.md's
// phase 16 follow-up). "glossary"/"contact" stay in this list even though
// they're unlinked below -- their own routes still resolve (as redirects
// into About's tabs, see those files), so a stale bookmark to either one
// still counts as a "safe to jump straight to when switching sport"
// bare listing page.
const SPORT_SECTIONS = [
  "tpe", "team-fits", "team-builder", "compare", "data", "players", "teams", "conferences", "glossary", "about",
  "contact",
] as const;

const LINKS: { section: (typeof SPORT_SECTIONS)[number]; label: string }[] = [
  { section: "tpe", label: "Transfer Projection" },
  { section: "team-fits", label: "Team Fits" },
  { section: "team-builder", label: "Team Builder" },
  { section: "compare", label: "Compare" },
  { section: "data", label: "Data" },
  { section: "players", label: "Players" },
  { section: "teams", label: "Teams" },
  // { section: "conferences", label: "Conferences" }, // hidden for now -- pages still live, just unlinked
];

// About/Glossary/Contact collapsed from 3 nav links into 1 -- Glossary and
// Contact are now tabs on the About page (?tab=glossary / ?tab=contact)
// instead of separate pages, so there's only one link to them here.
const STATIC_LINKS: { section: (typeof SPORT_SECTIONS)[number]; label: string }[] = [
  { section: "about", label: "About" },
];

// Client component only for the small bit of interactivity (open/close on
// small screens, and now the sport toggle) -- the links themselves are
// still plain <Link>s, so this doesn't change how the rest of the site
// fetches data server-side.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Every real page on the site now lives under /{sport}/... (including
  // home, about, contact, and glossary -- see ARCHITECTURE_HOSTING_PLAN.md's
  // phase 16 follow-up), so this should always find a sport segment in
  // practice. The "women" default only matters for a legacy pre-split
  // route (e.g. a bare /teams bookmark) that hasn't redirected yet.
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
  const onHomePage = segments.length === 1;
  const onBareSectionPage = segments.length === 2 && SPORT_SECTIONS.includes(currentSection as (typeof SPORT_SECTIONS)[number]);
  // Home page (exactly /{sport}, no section segment) switches sport and
  // stays on the home page -- previously fell through to the generic
  // "unknown page shape" fallback below and got sent to the Teams listing
  // instead, since segments.length === 1 never matched onBareSectionPage's
  // length === 2 check.
  const otherSportHref = onHomePage
    ? `/${otherSport}`
    : onBareSectionPage
      ? `/${otherSport}/${currentSection}`
      : `/${otherSport}/teams`;

  return (
    <>
      {/* .nav-panel wraps the links, sport toggle, and theme toggle together
          -- on desktop it's `display: contents` (see globals.css) so its
          children flow directly in the header's flex row exactly as before.
          On mobile, this whole panel collapses behind the hamburger instead
          of just the link list, so the collapsed header only shows the
          brand + hamburger -- previously the sport toggle and theme toggle
          stayed visible in the header row at every width, crowding it next
          to the brand mark and hamburger button even before the menu opened. */}
      <div className={`nav-panel${open ? " open" : ""}`}>
        <div className="nav-panel-controls">
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
        </div>
        <div className="links">
          {LINKS.map((l) => (
            <Link key={l.section} href={`/${currentSport}/${l.section}`} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          {STATIC_LINKS.map((l) => (
            <Link key={l.section} href={`/${currentSport}/${l.section}`} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
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
