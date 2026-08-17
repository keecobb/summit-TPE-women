"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Click-to-sort table header. Self-contained (reads/writes the URL's own
// `sort`/`dir` query params via next/navigation) rather than taking a
// callback prop, because Server Components can't pass functions across the
// server/client boundary -- every page that wants sortable columns just
// drops this in as <SortableTh column="ppg" label="PPG" />, no wiring
// needed on the page itself beyond reading `sort`/`dir` back out of
// searchParams when building its own data fetch/sort.
//
// Resets `page` to 1 on every sort change -- re-sorting a paginated list
// and landing on page 3 of the NEW order (which is almost certainly not
// where the player you were looking at moved to) is more confusing than
// just returning to page 1.
export default function SortableTh({
  column,
  label,
  defaultDir = "desc",
}: {
  column: string;
  label: string;
  defaultDir?: "asc" | "desc";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSort = searchParams.get("sort");
  const currentDir = (searchParams.get("dir") as "asc" | "desc") || "desc";
  const isActive = currentSort === column;
  const nextDir: "asc" | "desc" = isActive ? (currentDir === "desc" ? "asc" : "desc") : defaultDir;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", column);
    params.set("dir", nextDir);
    params.delete("page");
    // scroll: false -- re-sorting a table shouldn't jump the viewport back
    // to the top of the page, same reasoning as FilterForm's submit handler.
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <th
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{ cursor: "pointer", userSelect: "none" }}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ display: "inline-block", width: 12, opacity: isActive ? 1 : 0.25, marginLeft: 3 }}>
        {isActive ? (currentDir === "desc" ? "▼" : "▲") : "▼"}
      </span>
    </th>
  );
}
