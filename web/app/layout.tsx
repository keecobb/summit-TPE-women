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
  // suppressHydrationWarning below: the inline script sets data-theme on
  // <html> before React hydrates (that's the point -- no flash of the
  // wrong theme on load), so server HTML and the first client render are
  // expected to differ on this one attribute. Without this, React logs a
  // harmless-but-noisy hydration mismatch warning in dev on every page.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element -- small fixed-size
                  brand mark; next/image's extra runtime isn't worth it here. */}
              <img src="/summit-tpe-mark.png" alt="Summit TPE" />
              Summit <span>TPE</span>
            </Link>
            <MobileNav />
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          {/* The full wordmark logo has dark text baked into the image, so it's
              wrapped in a solid white chip -- keeps it legible against the green
              footer in both light and dark theme rather than only looking right
              in one of the two. */}
          <div
            style={{
              display: "inline-flex",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 14px",
              marginBottom: 12,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/estrella-logo-full.png" alt="Estrella Works" style={{ height: 44, width: "auto", display: "block" }} />
          </div>
          <div>
            Summit TPE by Estrella Works &middot; team ratings, Summit Scores, and transfer projections, refreshed
            periodically from the Summit TPE pipeline. &middot; <Link href="/about">About</Link> &middot;{" "}
            <Link href="/contact">Contact</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
