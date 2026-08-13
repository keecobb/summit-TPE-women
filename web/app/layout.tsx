import type { Metadata } from "next";
import Link from "next/link";
import MobileNav from "@/components/MobileNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summit TPE",
  description: "Team strength ratings, player Summit Scores, and transfer-portal projections.",
};

// Runs before paint (blocking, inline -- not a module) so the page never
// flashes the wrong theme: reads a saved choice from localStorage, falls
// back to the OS-level prefers-color-scheme, and sets data-theme on <html>
// before React hydrates. ThemeToggle.tsx (a client component) takes over
// from there once the page is interactive.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = window.localStorage.getItem("summit-tpe-theme");
    var theme = saved === "dark" || saved === "light"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    // localStorage/matchMedia unavailable -- default light theme from globals.css stands
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              {/* TODO: swap for the real Estrella Works logo file once uploaded --
                  placeholder mark below approximates it in CSS/text only. */}
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: "linear-gradient(135deg, var(--gold), var(--gold-dim))",
                  color: "#191008",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                }}
              >
                W
              </span>
              Summit <span>TPE</span>
            </Link>
            <MobileNav />
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Summit TPE by Estrella Works &middot; team ratings, Summit Scores, and transfer projections, refreshed
          periodically from the Summit TPE pipeline. &middot; <Link href="/about">About</Link> &middot;{" "}
          <Link href="/contact">Contact</Link>
        </footer>
      </body>
    </html>
  );
}
