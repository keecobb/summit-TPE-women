"""Direct test of presto_client.get_gamelog_boxscore_links() -- the
current, real source of a season's box score links (replacing both the
team-hub page's partial table and the '/schedule' page's inconsistent
templates, see that function's docstring for the full history).

Usage:
    python scrapers/diag_presto_gamelog_links.py <team_hub_url>

<team_hub_url> is the SAME URL stored in the Teams sheet's "Roster URL"
column for a Presto team (".../teams/<slug>", no query string needed --
this script appends '?view=gamelog' itself).

Example:
    python scrapers/diag_presto_gamelog_links.py \\
        https://ferrisstatebulldogs.com/sports/wbkb/2025-26/teams/ferrisst
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import presto_client as presto

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_gamelog_links.py <team_hub_url>")
    sys.exit(1)

team_hub_url = sys.argv[1].rstrip("/")
sep = "&" if "?" in team_hub_url else "?"
gamelog_url = f"{team_hub_url}{sep}view=gamelog"

print(f"Fetching: {gamelog_url}")
try:
    links = presto.get_gamelog_boxscore_links(gamelog_url)
except presto.PrestoError as exc:
    print(f"PrestoError: {exc}")
    sys.exit(1)

print(f"get_gamelog_boxscore_links() returned {len(links)} link(s)")
for l in links[:5]:
    print(f"  {l}")
if len(links) > 5:
    print(f"  ... ({len(links) - 5} more)")
print(f"  ...")
for l in links[-3:]:
    print(f"  {l}")
