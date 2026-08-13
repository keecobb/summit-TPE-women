"""Diagnostic: dumps every cell (header AND data row) of a specific
<table> on a page, including which cells are <th> vs <td> and whether
each cell contains a link. Use this when diag_roster_table.py's header
list is missing an expected column (e.g. no "Name"/"Full Name"/"Player"/
"Athlete" and no "First"/"Last" either) -- that usually means the name
lives in an unlabeled column that only shows up once you look at an
actual DATA row, not just the header row.

Usage:
    python scrapers/diag_row_cells.py <url> <table_index>

table_index is the table[N] index as reported by diag_roster_table.py.

Example:
    python scrapers/diag_row_cells.py https://salemtigers.com/sports/womens-basketball/roster/2025-26 2
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm
from bs4 import BeautifulSoup

if len(sys.argv) < 3:
    print("Usage: python scrapers/diag_row_cells.py <url> <table_index>")
    sys.exit(1)

url = sys.argv[1]
table_index = int(sys.argv[2])

html, final_url = sidearm._get_html(url, return_final_url=True)
print(f"Requested: {url}")
print(f"Final URL: {final_url}")

soup = BeautifulSoup(html, "lxml")
tables = soup.find_all("table")
if table_index >= len(tables):
    print(f"Only {len(tables)} tables found, index {table_index} out of range.")
    sys.exit(1)

table = tables[table_index]

thead = table.find("thead")
print()
print("=== <thead> row(s), cell-by-cell ===")
if thead:
    for tr in thead.find_all("tr"):
        for i, cell in enumerate(tr.find_all(["th", "td"])):
            tag = cell.name
            text = cell.get_text(strip=True)
            print(f"  [{i}] <{tag}> {text!r}")
else:
    print("  (no <thead>)")

body = table.find("tbody") or table
data_rows = body.find_all("tr")
print()
print(f"=== First 2 data row(s) of {len(data_rows)}, cell-by-cell ===")
shown = 0
for tr in data_rows:
    cells = tr.find_all(["th", "td"])
    if not cells:
        continue
    print(f"  -- row --")
    for i, cell in enumerate(cells):
        tag = cell.name
        text = cell.get_text(strip=True)
        link = cell.find("a", href=True)
        href = link["href"] if link else None
        print(f"  [{i}] <{tag}> {text!r}" + (f"  href={href!r}" if href else ""))
    shown += 1
    if shown >= 2:
        break
