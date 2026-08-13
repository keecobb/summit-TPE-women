"""Bootstrap diagnostic for PrestoSports sites -- the same role
diag_roster_table.py played for confirming Adams State's real HTML
before sidearm_client.py got written (see that module's docstring).
We have 18 D2 teams tagged SiteType="Presto" in the Teams sheet with NO
parser built for them yet at all, so before writing one line of parsing
code we need real ground truth on: what does the team-hub page actually
contain, where do roster/schedule/box-score links point, and what does
a roster table's headers look like.

Fetches ONE url with the exact same plain-requests code path the real
scrapers use, then dumps:
  - every <table> element's header cells (so we can see the roster/
    schedule/stats table shapes, same as diag_roster_table.py)
  - every distinct link whose text or href suggests roster/schedule/
    stats/box score, since Presto's team-hub URL structure
    (.../sports/wbkb/2025-26) is different from Sidearm's separate
    /roster and /schedule pages and we don't yet know where those live
  - any season-selector dropdown, same as diag_roster_table.py

Usage:
    python scrapers/diag_presto_page.py <url>

Example:
    python scrapers/diag_presto_page.py https://ferrisstatebulldogs.com/sports/wbkb/2025-26
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm  # reuse _get_html -- identical requests/User-Agent code path
from bs4 import BeautifulSoup

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_page.py <url>")
    sys.exit(1)

url = sys.argv[1]
html, final_url = sidearm._get_html(url, return_final_url=True)
print(f"Requested: {url}")
print(f"Final URL after redirects: {final_url}")
print(f"Fetched {len(html)} bytes")

soup = BeautifulSoup(html, "lxml")

title = soup.find("title")
print(f"Page <title>: {title.get_text(strip=True) if title else None!r}")

print()
print(f"=== Found {len(soup.find_all('table'))} <table> element(s) ===")
for i, t in enumerate(soup.find_all("table")):
    headers = [th.get_text(strip=True) for th in t.find_all("th")]
    print(f"  table[{i}] header cells: {headers}")

print()
print("=== Links whose href or text suggests roster/schedule/stats/box score (first 40 unique) ===")
seen = set()
count = 0
pattern = re.compile(r"roster|schedule|stat|box.?score", re.IGNORECASE)
for a in soup.find_all("a", href=True):
    href = a["href"]
    text = a.get_text(strip=True)
    if pattern.search(href) or pattern.search(text):
        key = (href, text)
        if key in seen:
            continue
        seen.add(key)
        print(f"  text={text!r} href={href!r}")
        count += 1
        if count >= 40:
            break

print()
print("=== Season-selector dropdown, if any ===")
found_selector = False
for select in soup.find_all("select"):
    opts = [(o.get_text(strip=True), o.get("value")) for o in select.find_all("option")]
    if any(re.search(r"\d{4}", (t or "")) for t, v in opts):
        found_selector = True
        print(f"  <select> with {len(opts)} options:")
        for text, value in opts[:30]:
            print(f"    {text!r} -> value={value!r}")
if not found_selector:
    print("  (none found)")

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diag_presto_output.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\nFull raw HTML saved to {out_path} for inspection if needed.")
