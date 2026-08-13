"""Import hand-filled-in Position/Height/Class values from a CSV back
into the workbook -- the manual-entry counterpart to the two automated
enrich_*_position_height_class.py scripts.

Why a separate importer instead of hand-editing the xlsx directly: the
live workbook has 25,000+ Player rows and 37,000+ PlayerSeasons rows
across multiple sheets that need to stay in sync (a Position value has
to land in BOTH the per-season PlayerSeasons row and the master Players
row) -- easy to mis-click a row in Excel at that scale. Filling in a
flat CSV and importing it is safer and leaves a record of exactly what
was hand-entered.

Expected CSV columns (matches what build_manual_worklist() in the
enrichment scripts produces, regenerated as a proper fill-in template):
    Player ID, First Name, Last Name, Team, Season, Position, Height, Class
Only Position/Height/Class are read for writing -- everything else is
just context to help you look the player up. Leave a cell blank to skip
it; only non-blank cells get written.

Safety rule: by default, a value is only written if the corresponding
cell in the workbook is CURRENTLY BLANK -- this can never clobber data
some other pass already filled in between when you exported the CSV and
now. Pass --overwrite if you're deliberately correcting a wrong value
that's already there.

Usage:
    python scrapers/import_manual_position_data.py my_filled_in.csv
    python scrapers/import_manual_position_data.py my_filled_in.csv --overwrite
"""

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", help="The filled-in CSV to import")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite cells that already have a value (default: only fill blanks)")
    parser.add_argument("--path", default=DEFAULT_PATH)
    args = parser.parse_args()

    print(f"Reading {args.csv_path} ...")
    with open(args.csv_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    print(f"{len(rows)} CSV rows.")

    required = {"Player ID", "Season"}
    if rows and not required.issubset(rows[0].keys()):
        raise SystemExit(f"CSV is missing required column(s): {required - set(rows[0].keys())}")

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    pws = wb["Players"]
    ph = header_map(pws)
    player_row_by_id = {}
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid is not None:
            player_row_by_id[pid] = row

    psws = wb["PlayerSeasons"]
    psh = header_map(psws)
    season_row_by_pid = {}
    for row in range(2, psws.max_row + 1):
        pid = psws.cell(row=row, column=psh["Player ID"]).value
        season = psws.cell(row=row, column=psh["Season"]).value
        if pid is not None:
            season_row_by_pid[(pid, season)] = row

    updated_players = 0
    updated_seasons = 0
    skipped_not_found = []
    skipped_blank_input = 0
    fields = ["Position", "Height", "Class"]

    for csv_row in rows:
        pid_raw = (csv_row.get("Player ID") or "").strip()
        if not pid_raw:
            continue
        try:
            pid = int(pid_raw)
        except ValueError:
            skipped_not_found.append((pid_raw, "Player ID not an integer"))
            continue
        season = (csv_row.get("Season") or "").strip()

        values = {f: (csv_row.get(f) or "").strip() for f in fields}
        if not any(values.values()):
            skipped_blank_input += 1
            continue

        prow = player_row_by_id.get(pid)
        srow = season_row_by_pid.get((pid, season))
        if prow is None and srow is None:
            skipped_not_found.append((pid, f"no Players or PlayerSeasons row for (Player ID={pid}, Season={season!r})"))
            continue

        for field, value in values.items():
            if not value:
                continue
            if prow is not None:
                cell = pws.cell(row=prow, column=ph[field])
                if args.overwrite or not cell.value:
                    if cell.value != value:
                        cell.value = value
                        updated_players += 1
            if srow is not None:
                cell = psws.cell(row=srow, column=psh[field])
                if args.overwrite or not cell.value:
                    if cell.value != value:
                        cell.value = value
                        updated_seasons += 1

    print(f"\nPlayers sheet cells written: {updated_players}")
    print(f"PlayerSeasons sheet cells written: {updated_seasons}")
    print(f"CSV rows with nothing filled in (skipped): {skipped_blank_input}")
    if skipped_not_found:
        print(f"\n{len(skipped_not_found)} rows couldn't be matched to a workbook row:")
        for pid, reason in skipped_not_found[:20]:
            print(f"  Player ID {pid}: {reason}")
        if len(skipped_not_found) > 20:
            print(f"  ... and {len(skipped_not_found) - 20} more")

    if updated_players == 0 and updated_seasons == 0:
        print("\nNothing to save.")
        return

    print("\nSaving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
