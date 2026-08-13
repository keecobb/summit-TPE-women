"""One-off repair: fix PlayerSeasons/Players rows whose Division column
doesn't match what the Teams sheet actually says for that row's Team ID.

Root cause (now fixed going forward in run_d2_scrape.py's
process_boxscore_side(), see its comment there): whenever a D2 team
played a non-conference game against a D1 (or other-division) opponent,
that opponent's players were being written with Division=info["division"]
-- the division of whichever D2 team was CURRENTLY BEING SCRAPED, not
the opponent's own real division. Team ID was always correct (so game
data itself is fine), just the Division label on the opponent's
PlayerSeasons/Players rows. Confirmed live: 642 PlayerSeasons rows have
Division="D2" but a Team ID that the Teams sheet says is actually D1
(Iowa, Stanford, Kansas, Colorado, etc.) -- almost entirely from
non-conference D2-vs-D1 games.

Since Team ID was never wrong, this is a safe, mechanical fix: for every
PlayerSeasons/Players row, look up the CORRECT division for its Team ID
from the Teams sheet and overwrite the row's Division if it disagrees.
No re-scraping needed.

Usage:
    python scrapers/fix_division_mislabels.py
    python scrapers/fix_division_mislabels.py --dry-run
"""

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    teams_ws = wb["Teams"]
    th = header_map(teams_ws)
    team_id_to_division = {}
    for row in range(2, teams_ws.max_row + 1):
        tid = teams_ws.cell(row=row, column=th["Team ID"]).value
        if tid is None:
            continue
        div = teams_ws.cell(row=row, column=th["Division"]).value
        if div:
            team_id_to_division[tid] = div

    total_fixed = 0
    for sheet_name in ("PlayerSeasons", "Players"):
        ws = wb[sheet_name]
        h = header_map(ws)
        col_team = h["Team ID"]
        col_div = h["Division"]
        fixed_by_correct_division = Counter()
        fixed_rows = 0
        for row in range(2, ws.max_row + 1):
            tid = ws.cell(row=row, column=col_team).value
            if tid is None:
                continue
            correct_div = team_id_to_division.get(tid)
            if correct_div is None:
                continue
            current_div = ws.cell(row=row, column=col_div).value
            if current_div != correct_div:
                fixed_rows += 1
                fixed_by_correct_division[f"{current_div!r} -> {correct_div!r}"] += 1
                if not args.dry_run:
                    ws.cell(row=row, column=col_div, value=correct_div)
        print(f"{sheet_name}: {fixed_rows} row(s) {'would be' if args.dry_run else ''} fixed")
        for change, count in fixed_by_correct_division.most_common(10):
            print(f"    {change}: {count}")
        total_fixed += fixed_rows

    print()
    print(f"Total rows {'that would be' if args.dry_run else ''} fixed: {total_fixed}")

    if args.dry_run:
        print("Dry run -- no changes saved.")
        return

    print("Saving ...")
    save_with_retry(wb, args.path)
    print("Saved.")


if __name__ == "__main__":
    main()
