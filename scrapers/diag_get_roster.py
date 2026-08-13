"""Diagnostic for get_roster()'s season-selector fallback path (see
_find_season_url_from_selector() in sidearm_client.py). Where
diag_roster_table.py inspects a single URL fetch, this calls the REAL
production get_roster() function end to end (same retries, same
season-candidate loop, same selector fallback) and, if it fails, walks
through every internal step with verbose prints -- so we can see
exactly which step breaks instead of guessing from the one-line error
message run_d2_scrape.py prints (which doesn't distinguish "no
selector match found" from "selector matched, but the fetch it pointed
at also failed" from "selector logic never even ran").

Usage:
    python scrapers/diag_get_roster.py <bare_roster_url> <season, e.g. 2025-26>

Example:
    python scrapers/diag_get_roster.py https://goldeneaglesports.com/sports/womens-basketball/roster 2025-26
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
import sidearm_client as sidearm

if len(sys.argv) < 3:
    print("Usage: python scrapers/diag_get_roster.py <bare_roster_url> <season>")
    sys.exit(1)

url = sys.argv[1].rstrip("/")
season = sys.argv[2]

print(f"=== Step 1: calling the REAL sidearm.get_roster({url!r}, season_path={season!r}) ===")
try:
    roster = sidearm.get_roster(url, season_path=season)
    print(f"SUCCESS -- got {len(roster)} players.")
    print(f"First few: {roster[:3]}")
    sys.exit(0)
except sidearm.SidearmError as exc:
    print(f"FAILED: {exc}")

print()
print("=== Step 2: replaying the season-candidate loop manually ===")
bare_html, bare_final_url = None, None
for candidate in sidearm._season_path_candidates(season):
    candidate_url = f"{url}/{candidate}"
    html, final_url = sidearm._get_html(candidate_url, return_final_url=True)
    page_season = sidearm._extract_page_season(html)
    matches = sidearm._season_matches(html, final_url, candidate)
    print(f"  candidate {candidate!r} -> {candidate_url}")
    print(f"    final URL: {final_url}")
    print(f"    page's declared season: {page_season!r}")
    print(f"    _season_matches: {matches}")
    if not matches:
        bare_html, bare_final_url = html, final_url
        continue
    print("    -> would parse_roster() this page (season matched)")
    try:
        r = sidearm.parse_roster(html, candidate_url)
        print(f"    parse_roster SUCCEEDED with {len(r)} players -- get_roster() should have returned here!")
    except sidearm.SidearmError as exc:
        print(f"    parse_roster FAILED: {exc}")

print()
print("=== Step 3: season-selector fallback ===")
if bare_html is None:
    print("  No candidate ever mismatched season (or loop never ran) -- fetching bare URL directly.")
    try:
        bare_html, bare_final_url = sidearm._get_html(url, return_final_url=True)
    except sidearm.SidearmError as exc:
        print(f"  Bare URL fetch FAILED: {exc}")
        sys.exit(1)
print(f"  Using page: {bare_final_url}")
print(f"  Page's declared season: {sidearm._extract_page_season(bare_html)!r}")

selector_href = sidearm._find_season_url_from_selector(bare_html, season)
print(f"  _find_season_url_from_selector(html, {season!r}) -> {selector_href!r}")

if not selector_href:
    print()
    print("  No matching <option> found. Dumping every <select> option on this page:")
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(bare_html, "lxml")
    for select in soup.find_all("select"):
        opts = [(o.get_text(strip=True), o.get("value")) for o in select.find_all("option")]
        print(f"  <select> with {len(opts)} options:")
        for text, value in opts:
            m = sidearm.SEASON_OPTION_TEXT_RE.search(text)
            option_short = None
            if m:
                option_short = f"{m.group(1)}-{m.group(2)[-2:]}"
            print(f"    {text!r} -> value={value!r}  (parsed season: {option_short!r}, 'basketball' in text.lower(): {'basketball' in text.lower()})")
    sys.exit(1)

selector_url = (
    selector_href if selector_href.startswith("http")
    else requests.compat.urljoin(bare_final_url, selector_href)
)
print(f"  Would fetch: {selector_url}")
html2, final_url2 = sidearm._get_html(selector_url, return_final_url=True)
print(f"    final URL: {final_url2}")
page_season2 = sidearm._extract_page_season(html2)
print(f"    page's declared season: {page_season2!r}")
matches2 = sidearm._season_matches(html2, final_url2, season)
print(f"    _season_matches: {matches2}")
if not matches2:
    print("    -> selector target page ALSO doesn't match the season we want. This is the bug.")
    sys.exit(1)

try:
    r = sidearm.parse_roster(html2, selector_url)
    print(f"    parse_roster SUCCEEDED with {len(r)} players -- get_roster() should have returned here!")
except sidearm.SidearmError as exc:
    print(f"    parse_roster FAILED: {exc}")
    from bs4 import BeautifulSoup
    soup2 = BeautifulSoup(html2, "lxml")
    tables = soup2.find_all("table")
    print(f"    Found {len(tables)} <table> element(s) on the selector-target page:")
    for i, t in enumerate(tables):
        headers = [th.get_text(strip=True) for th in t.find_all("th")]
        print(f"      table[{i}] header cells: {headers}")
