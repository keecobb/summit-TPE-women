"""The team-hub ('teams/<slug>') page's Date/Opponent/Result table only
contains a partial game list in its raw static HTML (confirmed live,
Ferris State: 6 rows in the fetched HTML, but the user's browser shows
more) -- likely the same class of issue as box scores needing
'?view=boxscore' appended. Tries a handful of candidate '?view=' values
against both the team-hub URL and the real '/schedule' URL (which
returned 0 tables entirely on its own, unlike the team-hub page) to see
which one (if any) returns a page with a longer game list.

Usage:
    python scrapers/diag_presto_schedule_views.py <team_hub_url> <schedule_url>

Example:
    python scrapers/diag_presto_schedule_views.py \\
        https://ferrisstatebulldogs.com/sports/wbkb/2025-26/teams/ferrisst \\
        https://ferrisstatebulldogs.com/sports/wbkb/2025-26/schedule
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm
from bs4 import BeautifulSoup

if len(sys.argv) < 3:
    print("Usage: python scrapers/diag_presto_schedule_views.py <team_hub_url> <schedule_url>")
    sys.exit(1)

team_hub_url, schedule_url = sys.argv[1], sys.argv[2]

candidates = []
for base_label, base_url in [("team-hub", team_hub_url), ("schedule", schedule_url)]:
    candidates.append((f"{base_label} (plain)", base_url))
    for view in ["schedule", "results", "full", "all", "season"]:
        sep = "&" if "?" in base_url else "?"
        candidates.append((f"{base_label} ?view={view}", f"{base_url}{sep}view={view}"))

for label, url in candidates:
    try:
        html, final_url = sidearm._get_html(url, return_final_url=True)
    except sidearm.SidearmError as exc:
        print(f"{label}: FAILED ({exc})")
        continue
    soup = BeautifulSoup(html, "lxml")
    game_row_count = 0
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if tuple(header_cells[:3]) == ("Date", "Opponent", "Result"):
            game_row_count += max(0, len(rows) - 1)
    print(f"{label}: {len(html)} bytes, {len(soup.find_all('table'))} tables, "
          f"{game_row_count} Date/Opponent/Result row(s) found -- {url}")
