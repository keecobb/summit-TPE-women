"""Round 3 of opponent-name-resolution backfill (task #56).

Context: after task #46's state-abbreviation fix and its repair script,
4,334 Games-sheet opponent-side occurrences (1,007 distinct names) were
still unresolved. A sample check found the large majority of those are
NOT genuinely untracked schools -- they're teams we already track, just
written in a form the matcher didn't yet bridge:

  - Renamed/old-name schools: "Cal Poly Humboldt" (Humboldt State
    renamed 2022), "MSU Moorhead"/"Minnesota State Moorhead" (Moorhead
    State), "Southern New Hampshire" (stored as the likely-typo'd
    "South New Hampshire"), "Western Colorado" (stored as "Western
    State", its older/informal name). Each verified individually via
    Roster URL/mascot before being added as an alias in
    run_d2_scrape.py's/run_d2_presto_scrape.py's new TEAM_NAME_ALIASES.
  - Hyphenated compact branch-campus names: "Mo.-St. Louis",
    "Neb.-Kearney", "Wis.-Parkside", "Ark.-Fort Smith", "Ark.-Monticello",
    "Minn.-Crookston" -- all already tracked, just under a
    space-separated or differently-punctuated form. Fixed generally via
    a hyphen-to-space candidate, not a per-school list.
  - Parenthetical state-qualifier drops: "Northwood" (tracked as
    "Northwood (MI)"), "Regis" (tracked as "Regis (CO)"... in this case
    already exact), "Northern State" (tracked as "Northern State (SD)").
    Fixed generally via a parenthetical-strip candidate.
  - A couple of initialisms/nicknames worth the individual verification:
    "UIndy" -> Indianapolis (NOT the separate D1 school "IU
    Indianapolis"), "USC Beaufort"/"USC Aiken" -> South Carolina
    Beaufort/Aiken, "UNC Pembroke" -> North Carolina Pembroke.
  - Two more abbreviation-dict entries ("fran." -> "francisco",
    "int'l" -> "international") for "San Fran. St." -> San Francisco
    State and "American Int'l" -> American International.

This script rebuilds the Games-sheet opponent index using
run_d2_scrape.build_team_index() (tier-1/tier-2 collision-safe -- an
ambiguous key that more than one team claims is dropped, never guessed;
see that function's docstring for a real regression this caught during
testing) and backfills any Home/Away Team ID that's currently blank and
now resolves, looking up each literal opponent name via
query_candidates() (deliberately narrower than the index-building
candidates -- see that function's docstring for a second real bug this
caught: a query must never strip its OWN parenthetical qualifier).

This does NOT touch Players/PlayerGameStats/PlayerSeasons directly --
run audit_players_and_stats.py --write again afterward to pick up
whatever this newly unlocks for the -1 Team ID player repair (it
already reuses the same shared matching functions from run_d2_scrape.py,
so it benefits automatically from everything added here).

Usage:
    python scrapers/repair_opponent_names_round3.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run_d2_scrape import build_team_index, normalize_text, query_candidates
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    print(f"Opening {path} ...")
    wb = open_workbook(path)

    tws = wb["Teams"]
    th = header_map(tws)
    name_team_pairs = [
        (row[th["Team"] - 1], row[th["Team ID"] - 1])
        for row in tws.iter_rows(min_row=2, values_only=True)
        if row[th["Team"] - 1] and row[th["Team ID"] - 1] is not None
    ]
    # full=False: deliberately narrow, no University/College suffix
    # stripping -- see run_d2_scrape.build_team_index()'s docstring and
    # repair_opponent_names.py's module docstring for why every repair
    # script in this project stays on the narrow side of that tradeoff.
    name_to_id = build_team_index(name_team_pairs, full=False)
    print(f"Built index: {len(name_to_id)} resolvable name forms "
          f"(tier-1/tier-2 collision-safe, see build_team_index()).")

    gws = wb["Games"]
    gh = header_map(gws)

    fixed = 0
    fixed_names = {}
    for row in range(2, gws.max_row + 1):
        home_id = gws.cell(row=row, column=gh["Home Team ID"]).value
        away_id = gws.cell(row=row, column=gh["Away Team ID"]).value

        if home_id is None:
            home_name = gws.cell(row=row, column=gh["Home Team"]).value
            if home_name:
                matched_id = name_to_id.get(normalize_text(home_name)) or _try_candidates(home_name, name_to_id)
                if matched_id is not None:
                    gws.cell(row=row, column=gh["Home Team ID"], value=matched_id)
                    fixed += 1
                    fixed_names[home_name] = fixed_names.get(home_name, 0) + 1

        if away_id is None:
            away_name = gws.cell(row=row, column=gh["Away Team"]).value
            if away_name:
                matched_id = name_to_id.get(normalize_text(away_name)) or _try_candidates(away_name, name_to_id)
                if matched_id is not None:
                    gws.cell(row=row, column=gh["Away Team ID"], value=matched_id)
                    fixed += 1
                    fixed_names[away_name] = fixed_names.get(away_name, 0) + 1

    print(f"\nBackfilled {fixed} Home/Away game-side occurrences across "
          f"{len(fixed_names)} distinct opponent names:")
    for name, count in sorted(fixed_names.items(), key=lambda x: -x[1])[:60]:
        print(f"  {count:4d}  {name!r}")
    if len(fixed_names) > 60:
        print(f"  ... and {len(fixed_names) - 60} more distinct names")

    if fixed == 0:
        print("\nNothing changed.")
        return

    print("\nSaving ...")
    save_with_retry(wb, path)
    print("Done.")


def _try_candidates(name, name_to_id):
    """A literal opponent name is looked up via query_candidates() --
    narrow-normalize and hyphen-swap only, deliberately NOT the
    parenthetical-strip candidate. BUG FOUND DURING TESTING: an earlier
    version of this function used build_match_candidates() (the
    TEAMS-sheet-side candidate set) for the query too, which let a
    query like "Notre Dame (OH)" strip its own qualifier down to bare
    "Notre Dame" and match the real, separately-tracked D1 Notre Dame --
    the wrong school. See query_candidates()'s docstring in
    run_d2_scrape.py for the full story."""
    for key in query_candidates(name):
        if key in name_to_id:
            return name_to_id[key]
    return None


if __name__ == "__main__":
    main()
