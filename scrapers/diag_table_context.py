"""Diagnostic: for a <table> whose rows have no name-bearing cell at
all (confirmed live, Salem (WV): 7 <td> cells per row, none of them a
player name -- see diag_row_cells.py output), the name almost certainly
lives somewhere OUTSIDE that <table> entirely (e.g. a "player card"
heading, or an <img alt="Player Name"> that get_text() can't see since
alt text isn't part of a tag's text content). This dumps the DOM
context around a specific table -- its ancestor chain, any <img alt=...>
inside each data row, and any nearby elements whose class attribute
mentions "name" or "player" -- to figure out where the name text
actually is.

Usage:
    python scrapers/diag_table_context.py <url> <table_index>
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm
from bs4 import BeautifulSoup

if len(sys.argv) < 3:
    print("Usage: python scrapers/diag_table_context.py <url> <table_index>")
    sys.exit(1)

url = sys.argv[1]
table_index = int(sys.argv[2])

html, final_url = sidearm._get_html(url, return_final_url=True)
soup = BeautifulSoup(html, "lxml")
tables = soup.find_all("table")
if table_index >= len(tables):
    print(f"Only {len(tables)} tables found.")
    sys.exit(1)
table = tables[table_index]

print("=== Ancestor chain of this <table> (tag + class/id) ===")
node = table
depth = 0
while node is not None and depth < 8:
    if hasattr(node, "name") and node.name:
        attrs = []
        if node.get("class"):
            attrs.append(f"class={node.get('class')}")
        if node.get("id"):
            attrs.append(f"id={node.get('id')}")
        print(f"  {'  ' * depth}<{node.name}> {' '.join(attrs)}")
    node = node.parent
    depth += 1

print()
print("=== <img alt=...> inside each of the first 3 data rows ===")
body = table.find("tbody") or table
rows = body.find_all("tr")
for i, tr in enumerate(rows[:3]):
    imgs = tr.find_all("img")
    print(f"  row {i}: {len(imgs)} <img> tag(s)")
    for img in imgs:
        print(f"    alt={img.get('alt')!r} src={img.get('src')!r}")
    # Also check for ANY attribute on any descendant that might carry a name
    for el in tr.find_all(True):
        for attr_name in ("title", "aria-label", "data-name"):
            if el.get(attr_name):
                print(f"    <{el.name} {attr_name}={el.get(attr_name)!r}>")

print()
print("=== Elements anywhere on the page whose class/id mentions 'name' or 'player' (first 25) ===")
count = 0
for el in soup.find_all(True):
    classes = " ".join(el.get("class") or [])
    id_ = el.get("id") or ""
    combined = f"{classes} {id_}".lower()
    if "name" in combined or "player" in combined:
        text = el.get_text(strip=True)[:60]
        print(f"  <{el.name} class={el.get('class')!r} id={id_!r}> text={text!r}")
        count += 1
        if count >= 25:
            break
if count == 0:
    print("  (none found)")
