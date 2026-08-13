"""Add a single in-workbook sheet listing every 2025-26 player still
missing Position and/or Height and/or Class -- combined D1 + D2, so you
can do lookups directly in Excel instead of juggling two separate CSV
exports (needs_manual_position_data.csv / needs_manual_position_data_d1.csv).

Freshly computed from the live workbook each run (not the old CSVs), so
it always reflects whatever the enrichment scripts have already
recovered. Re-running this script replaces the sheet from scratch -- safe
to run again after another enrichment pass to shrink the list, though
NOTE: any values you've already typed into the sheet that haven't been
imported yet (see import_manual_lookup_sheet.py) will be wiped by a
rerun, so import before you regenerate.

For each row, a "Lookup Hint" column gives you a head start:
  - D1 (ESPN-sourced) teams: a direct ESPN roster URL for that team.
  - D2 teams with a Roster URL on file: that URL.
  - D2 teams with NO Roster URL on file: flagged so you know to search
    for "<school> women's basketball roster 2025-26" yourself.

Position/Height/Class are left BLANK only where actually missing --
any field already resolved is carried through as-is, so you only ever
need to type into truly empty cells, and importing back can never
clobber a value that's already correct.

Usage:
    python scrapers/build_manual_lookup_sheet.py
    python scrapers/build_manual_lookup_sheet.py --season 2025-26
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
SHEET_NAME = "NeedsPositionHeightClass"

COLUMNS = [
    "Player ID", "First Name", "Last Name", "Team", "Division", "Season",
    "Lookup Hint", "Position", "Height", "Class",
]


def espn_roster_hint(espn_id):
    if not espn_id:
        return "D1 but no ESPN Team ID on file -- search manually"
    return f"https://www.espn.com/womens-college-basketball/team/roster/_/id/{espn_id}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()
    season = args.season

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    tws = wb["Teams"]
    th = header_map(tws)
    team_info = {}
    for row in range(2, tws.max_row + 1):
        tid = tws.cell(row=row, column=th["Team ID"]).value
        if tid is None:
            continue
        team_info[tid] = {
            "name": tws.cell(row=row, column=th["Team"]).value,
            "division": tws.cell(row=row, column=th["Division"]).value,
            "roster_url": tws.cell(row=row, column=th["Roster URL"]).value,
            "espn_id": tws.cell(row=row, column=th["ESPN Team ID"]).value,
        }

    pws = wb["Players"]
    ph = header_map(pws)
    player_names = {}
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid is None:
            continue
        player_names[pid] = (
            pws.cell(row=row, column=ph["First Name"]).value or "",
            pws.cell(row=row, column=ph["Last Name"]).value or "",
        )

    psws = wb["PlayerSeasons"]
    psh = header_map(psws)

    targets = []
    for row in range(2, psws.max_row + 1):
        pid = psws.cell(row=row, column=psh["Player ID"]).value
        if pid is None:
            continue
        if psws.cell(row=row, column=psh["Season"]).value != season:
            continue
        pos = psws.cell(row=row, column=psh["Position"]).value
        ht = psws.cell(row=row, column=psh["Height"]).value
        cls = psws.cell(row=row, column=psh["Class"]).value
        if pos and ht and cls:
            continue
        tid = psws.cell(row=row, column=psh["Team ID"]).value
        info = team_info.get(tid, {})
        division = info.get("division") or ("D2" if tid == -1 else "")
        if division == "D1":
            hint = espn_roster_hint(info.get("espn_id"))
        elif info.get("roster_url"):
            hint = info["roster_url"]
        elif tid is None or tid == -1:
            hint = "Team ID unresolved -- run audit_players_and_stats.py first"
        else:
            hint = "no Roster URL on file -- search manually"

        first, last = player_names.get(pid, ("", ""))
        targets.append({
            "Player ID": pid,
            "First Name": first,
            "Last Name": last,
            "Team": info.get("name") or ("UNRESOLVED (-1)" if tid == -1 else tid),
            "Division": division,
            "Season": season,
            "Lookup Hint": hint,
            "Position": pos or "",
            "Height": ht or "",
            "Class": cls or "",
        })

    # Group by team, then last name, so lookups can be done school-by-school.
    targets.sort(key=lambda r: (str(r["Team"]), r["Last Name"] or ""))

    print(f"{len(targets)} PlayerSeasons rows for {season} missing >=1 of Position/Height/Class.")

    if SHEET_NAME in wb.sheetnames:
        del wb[SHEET_NAME]
    ws = wb.create_sheet(SHEET_NAME)
    ws.append(COLUMNS)
    for r in targets:
        ws.append([r[c] for c in COLUMNS])
    ws.freeze_panes = "A2"
    for col_idx, col_name in enumerate(COLUMNS, start=1):
        width = max(12, min(40, len(col_name) + 4))
        if col_name == "Lookup Hint":
            width = 60
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = width

    print(f"\nWrote {len(targets)} rows to the '{SHEET_NAME}' sheet.")
    print("Fill in the blank Position/Height/Class cells directly in Excel, then run "
          "scrapers/import_manual_lookup_sheet.py to copy your entries back into "
          "Players/PlayerSeasons.")

    print("\nSaving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
