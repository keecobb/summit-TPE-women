"""Direct test of presto_client.get_schedule_boxscore_links() against a
live URL -- isolates whether the new data-boxscore-attribute scraping
actually works on a fresh fetch (it was only verified so far against a
previously-saved HTML file from diag_presto_page.py), since a real run
of run_d2_presto_scrape.py --force came back with ZERO per-game output
at all for either team -- no roster-failure print, no schedule-fetch-
failure print, no per-game print -- which most likely means the
boxscore_links list came back empty and the for-loop over it never ran.

Usage:
    python scrapers/diag_presto_schedule_links.py <schedule_url>

Example:
    python scrapers/diag_presto_schedule_links.py \\
        https://ferrisstatebulldogs.com/sports/wbkb/2025-26/schedule
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import presto_client as presto
import sidearm_client as sidearm

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_schedule_links.py <schedule_url>")
    sys.exit(1)

url = sys.argv[1]

# First, raw fetch + regex count, bypassing get_schedule_boxscore_links()
# entirely, to rule out a bug in that function's urljoin/dedup logic vs.
# a bug in the fetch itself (blocked/redirected/different content this
# time around).
html, final_url = sidearm._get_html(url, return_final_url=True)
print(f"Requested: {url}")
print(f"Final URL after redirects: {final_url}")
print(f"Fetched {len(html)} bytes")
raw_matches = presto.BOXSCORE_URL_RE.findall(html)
print(f"Raw regex found {len(raw_matches)} box score URL occurrence(s) in this fetch")
if raw_matches:
    print(f"  first: {raw_matches[0]}")
    print(f"  last: {raw_matches[-1]}")

print()
try:
    links = presto.get_schedule_boxscore_links(url)
except presto.PrestoError as exc:
    print(f"PrestoError: {exc}")
    sys.exit(1)

print(f"get_schedule_boxscore_links() returned {len(links)} link(s)")
for l in links[:5]:
    print(f"  {l}")
if len(links) > 5:
    print(f"  ... ({len(links) - 5} more)")
