"""Match Teams-sheet school names (D1 rows) to ESPN team IDs -- men's.

Mirrors scrapers/team_match.py exactly, just pointed at the men's ESPN
endpoint (scrapers.espn_client_mbb) and MensSummitTPE.xlsx, with its own
overrides file (espn_team_overrides_mbb.csv) so a manual fix for a men's
school name never collides with (or gets clobbered by) the women's
overrides file.

ESPN's team.location field is the clean school name with no mascot
("South Carolina", "Alabama A&M", "App State"), which is usually a
close match to what's already in the Teams sheet's "Team" column
("Abilene Christian", "Air Force", ...). Still, ~10-15% of schools
won't match automatically because of things like "St." vs "State",
"Ole Miss" vs "Mississippi", or "UConn" vs "Connecticut" -- names
each program brands itself with vs. ESPN's canonical name. Those go
into a CSV for you to fill in by hand once; the script re-reads that
file on every run, so you only ever have to fix a given school once.

Usage:
    python scrapers/team_match_mbb.py
Writes:
    scrapers/espn_team_overrides_mbb.csv  (created empty on first run --
        add rows "Team,ESPN Team ID" for anything unmatched, using
        the ESPN team ID printed in the unmatched list)
    Updates the "ESPN Team ID" column on every matched D1 row in Teams.
"""

import csv
import difflib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers.espn_client_mbb as espn
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "MensSummitTPE.xlsx")
OVERRIDES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "espn_team_overrides_mbb.csv")

FUZZY_THRESHOLD = 0.87


def normalize(name):
    name = name.lower().strip()
    name = name.replace("&", "and")
    name = re.sub(r"\bst\.?\b", "state", name)  # "St." / "St" -> "state" (imperfect but catches most)
    name = re.sub(r"[^a-z0-9 ]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        with open(OVERRIDES_PATH, "w", newline="") as f:
            csv.writer(f).writerow(["Team", "ESPN Team ID"])
        return {}
    overrides = {}
    with open(OVERRIDES_PATH, newline="") as f:
        for row in csv.DictReader(f):
            team = (row.get("Team") or "").strip()
            espn_id = (row.get("ESPN Team ID") or "").strip()
            if team and espn_id:
                overrides[team] = espn_id
    return overrides


def build_matches(sheet_team_names, espn_teams):
    """Returns (matches: {team_name: espn_id}, unmatched: [team_name])."""
    by_norm = {}
    for t in espn_teams:
        for key in (t.get("location"), t.get("name")):
            if key:
                by_norm.setdefault(normalize(key), t["espn_id"])

    overrides = load_overrides()
    matches = {}
    unmatched = []

    norm_keys = list(by_norm.keys())
    for team_name in sheet_team_names:
        if team_name in overrides:
            matches[team_name] = overrides[team_name]
            continue

        norm = normalize(team_name)
        if norm in by_norm:
            matches[team_name] = by_norm[norm]
            continue

        close = difflib.get_close_matches(norm, norm_keys, n=1, cutoff=FUZZY_THRESHOLD)
        if close:
            matches[team_name] = by_norm[close[0]]
        else:
            unmatched.append(team_name)

    return matches, unmatched


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    print("Fetching ESPN's D1 team list ...")
    espn_teams = espn.list_teams()
    print(f"  {len(espn_teams)} ESPN teams found.")

    wb = open_workbook(path)
    ws = wb["Teams"]
    hmap = header_map(ws)

    sheet_rows = []
    for row in range(2, ws.max_row + 1):
        name = ws.cell(row=row, column=hmap["Team"]).value
        division = ws.cell(row=row, column=hmap["Division"]).value
        if name and division == "D1":
            sheet_rows.append((row, name))

    matches, unmatched = build_matches([name for _, name in sheet_rows], espn_teams)

    espn_col = hmap["ESPN Team ID"]
    matched_count = 0
    for row, name in sheet_rows:
        if name in matches:
            ws.cell(row=row, column=espn_col, value=matches[name])
            matched_count += 1

    save_with_retry(wb, path)

    print(f"\nMatched {matched_count}/{len(sheet_rows)} D1 teams to an ESPN team ID.")
    if unmatched:
        print(f"\n{len(unmatched)} teams need a manual entry in {OVERRIDES_PATH}:")
        print("(find the ESPN team ID by searching espn.com/mens-college-basketball/team/_/id/XXXX/<school>)")
        for name in unmatched:
            print(f"  {name}")
        print(
            "\nAdd rows like:  Team Name,1234\nto the overrides CSV, then re-run this script."
        )
    else:
        print("Every D1 team matched -- nothing to add to the overrides file.")


if __name__ == "__main__":
    main()
