import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summit TPE",
  description: "Team strength ratings, player Hoop Scores, and transfer-portal projections.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              Summit <span>TPE</span>
            </Link>
            <div className="links">
              <Link href="/tpe">TPE Engine</Link>
              <Link href="/team-fits">Team Fits</Link>
              <Link href="/data">Data</Link>
              <Link href="/players">Players</Link>
              <Link href="/teams">Teams</Link>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Summit TPE -- team ratings, Hoop Scores, and transfer projections. Data refreshed periodically from the
          Summit TPE pipeline. &middot; <Link href="/about">About</Link> &middot; <Link href="/contact">Contact</Link>
        </footer>
      </body>
    </html>
  );
}
