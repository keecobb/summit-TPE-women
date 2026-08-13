"use client";

import { useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

const LINKS: { href: string; label: string }[] = [
  { href: "/tpe", label: "TPE Engine" },
  { href: "/team-fits", label: "Team Fits" },
  { href: "/compare", label: "Compare" },
  { href: "/data", label: "Data" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/conferences", label: "Conferences" },
  { href: "/glossary", label: "Glossary" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Client component only for the small bit of interactivity (open/close on
// small screens) -- the links themselves are still plain <Link>s, so this
// doesn't change how the rest of the site fetches data server-side.
export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`links${open ? " open" : ""}`}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
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
