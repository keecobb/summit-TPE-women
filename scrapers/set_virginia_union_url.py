"""One-off: fills in Virginia Union's missing Roster URL.

Found via web search + verified live (confirmed it's a real Sidearm
Sports site, footer says "Sidearm Sports", standard roster table
shape) -- see task #42. My sandbox's full load+save of the ~66MB
workbook (615k+ row PlayerGameStats sheet) times out before it can
finish writing, so this needs to run on your machine instead, same
as every other write against the real workbook.

Usage:
    python scrapers/set_virginia_union_url.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")

ROSTER_URL = "https://vuusports.com/sports/womens-basketball/roster"


def main():
    print(f"Opening {DEFAULT_PATH} ...")
    wb = open_workbook(DEFAULT_PATH)
    ws = wb["Teams"]
    h = header_map(ws)

    updated = 0
    for row in range(2, ws.max_row + 1):
        name = ws.cell(row=row, column=h["Team"]).value
        if name == "Virginia Union":
            ws.cell(row=row, column=h["Roster URL"], value=ROSTER_URL)
            ws.cell(row=row, column=h["Scrape Status"], value=None)
            updated += 1
            print(f"  Set Roster URL for Virginia Union -> {ROSTER_URL}")

    if updated == 0:
        print("  [!] No 'Virginia Union' row found -- check the Team name spelling in the Teams sheet.")
    else:
        print("Saving ...")
        save_with_retry(wb, DEFAULT_PATH)
        print("Done.")


if __name__ == "__main__":
    main()
