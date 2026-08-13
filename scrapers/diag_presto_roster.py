"""Quick check: does presto_client.get_roster() actually return players
for a given roster URL? Every Tampa box score tied 0-0 on roster overlap
in a real run, which only happens if roster_by_name ended up empty --
this calls the real parser directly (not just dumping raw HTML) to
confirm whether that's the roster fetch itself failing silently or
something else.

Usage:
    python scrapers/diag_presto_roster.py <roster_url>
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import presto_client as presto

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_roster.py <roster_url>")
    sys.exit(1)

url = sys.argv[1]
try:
    roster = presto.get_roster(url)
except presto.PrestoError as exc:
    print(f"PrestoError: {exc}")
    sys.exit(1)

print(f"Fetched {url}")
print(f"Parsed {len(roster)} player(s)")
for p in roster[:5]:
    print(f"  {p}")
if len(roster) > 5:
    print(f"  ... ({len(roster) - 5} more)")
