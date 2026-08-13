"""Quick diagnostic for a "No roster table found" failure: fetches a URL
using the EXACT same path sidearm_client.py's real scraper uses (plain
requests + lxml, same User-Agent, no JavaScript execution) and prints
every <table> element's header row it finds. Run this against a URL
that's failing so we can see what the parser is actually working with --
e.g. confirms whether the header text just doesn't match our alias
lists, or whether there's no <table> at all in the raw HTML (which would
mean the roster content needs JavaScript to render and requests-based
scraping fundamentally can't see it).

Usage:
    python scrapers/diag_roster_table.py <url>

Example:
    python scrapers/diag_roster_table.py https://bentleyfalcons.com/sports/womens-basketball/roster/2025-2026
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm
from bs4 import BeautifulSoup

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_roster_table.py <url>")
    sys.exit(1)

url = sys.argv[1]
html, final_url = sidearm._get_html(url, return_final_url=True)
print(f"Requested: {url}")
print(f"Final URL after redirects: {final_url}")
print(f"Fetched {len(html)} bytes")

page_season = sidearm._extract_page_season(html)
print(f"Page's own declared season (from <title>): {page_season!r}")

soup = BeautifulSoup(html, "lxml")
tables = soup.find_all("table")
print(f"Found {len(tables)} <table> element(s) in the raw HTML")
for i, t in enumerate(tables):
    headers = [th.get_text(strip=True) for th in t.find_all("th")]
    print(f"  table[{i}] header cells: {headers}")

if not tables:
    print()
    print("No <table> elements at all in the raw HTML -- this page's roster")
    print("content most likely requires JavaScript to render, which a plain")
    print("requests-based fetch (what the real scraper uses) can never see.")

# If the page's declared season doesn't match what we asked for, it's
# likely because the site's "bare" canonical roster URL has already
# rolled over to a NEWER season (e.g. we're asking for a season that's
# already finished, and the site defaults to next season's page by
# now) -- the season-suffixed candidate URL redirects to that same
# now-wrong-season bare page instead of 404ing. Dig up whatever the
# page's own "Choose A Season" selector links to, since those are
# likely the real, still-reachable URLs for each specific past season.
print()
print("Looking for a season-selector (dropdown or link list) on the page ...")
found_any = False
for select in soup.find_all("select"):
    opts = [(o.get_text(strip=True), o.get("value")) for o in select.find_all("option")]
    if any("women's basketball" in (t or "").lower() or "roster" in (t or "").lower() for t, v in opts):
        found_any = True
        print(f"  <select> with {len(opts)} options:")
        for text, value in opts[:40]:
            print(f"    {text!r} -> value={value!r}")

import re as _re
season_link_re = _re.compile(r"/roster/(\d{4}-\d{2,4})")
seen_links = set()
for a in soup.find_all("a", href=True):
    m = season_link_re.search(a["href"])
    if m and a["href"] not in seen_links:
        seen_links.add(a["href"])
        found_any = True
if seen_links:
    print(f"  {len(seen_links)} <a href> link(s) containing a season path:")
    for href in sorted(seen_links)[:40]:
        print(f"    {href}")

if not found_any:
    print("  Nothing obviously season-related found (no <select>, no /roster/<season> links).")

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diag_page_output.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\nFull raw HTML saved to {out_path} for inspection if needed.")
