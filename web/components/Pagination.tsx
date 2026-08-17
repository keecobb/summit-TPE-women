import Link from "next/link";

// Shared numbered-pagination control (Players, Teams). Renders First/Prev/
// Next/Last plus a windowed set of page-number links (with "..." gaps for
// large page counts) so a visitor can jump straight from page 1 to the
// last page instead of clicking Next repeatedly -- see the players/teams
// page requests this was built for.
export default function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const WINDOW = 2;
  const keep = new Set<number>([1, totalPages]);
  for (let p = page - WINDOW; p <= page + WINDOW; p++) {
    if (p >= 1 && p <= totalPages) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) items.push("gap");
    items.push(p);
    prev = p;
  }

  const atFirst = page <= 1;
  const atLast = page >= totalPages;
  const disabledStyle = { pointerEvents: "none" as const, opacity: 0.4 };

  return (
    <nav className="pagination" aria-label="Pagination">
      <Link className="btn" href={buildHref(1)} style={atFirst ? disabledStyle : undefined} aria-disabled={atFirst}>
        &laquo; First
      </Link>
      <Link
        className="btn"
        href={buildHref(Math.max(1, page - 1))}
        style={atFirst ? disabledStyle : undefined}
        aria-disabled={atFirst}
      >
        &larr; Prev
      </Link>
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`gap-${i}`} className="pagination-gap">
            &hellip;
          </span>
        ) : (
          <Link
            key={it}
            className={`btn${it === page ? " btn-primary" : ""}`}
            href={buildHref(it)}
            aria-current={it === page ? "page" : undefined}
          >
            {it}
          </Link>
        )
      )}
      <Link
        className="btn"
        href={buildHref(Math.min(totalPages, page + 1))}
        style={atLast ? disabledStyle : undefined}
        aria-disabled={atLast}
      >
        Next &rarr;
      </Link>
      <Link className="btn" href={buildHref(totalPages)} style={atLast ? disabledStyle : undefined} aria-disabled={atLast}>
        Last &raquo;
      </Link>
    </nav>
  );
}
