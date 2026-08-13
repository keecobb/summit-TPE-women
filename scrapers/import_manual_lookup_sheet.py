"""Copy filled-in Position/Height/Class values from the in-workbook
"NeedsPositionHeightClass" sheet (built by build_manual_lookup_sheet.py)
back into the Players and PlayerSeasons sheets -- no CSV round trip
needed since the lookup sheet already lives in the same workbook.

Safety rule: same as import_manual_position_data.py -- by default a
value is only written if the corresponding cell in the workbook is
CURRENTLY BLANK, so this can never clobber something another pass
already filled in since the lookup sheet was generated. Pass
--overwrite if you're deliberately correcting a wrong value.

Usage:
    python scrapers/import_manual_lookup_sheet.py
    python scrapers/import_manual_lookup_sheet.py --overwrite
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
SHEET_NAME = "NeedsPositionHeightClass"
FIELDS = ["Position", "Height", "Class"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite cells that already have a value (default: only fill blanks)")
    parser.add_argument("--path", default=DEFAULT_PATH)
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    if SHEET_NAME not in wb.sheetnames:
        raise SystemExit(f"No '{SHEET_NAME}' sheet found -- run build_manual_lookup_sheet.py first.")

    lws = wb[SHEET_NAME]
    lh = header_map(lws)
    required = {"Player ID", "Season", "Position", "Height", "Class"}
    missing = required - set(lh.keys())
    if missing:
        raise SystemExit(f"'{SHEET_NAME}' sheet is missing column(s): {missing}")

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
    scanned = 0

    for row in range(2, lws.max_row + 1):
        pid = lws.cell(row=row, column=lh["Player ID"]).value
        if pid is None:
            continue
        scanned += 1
        season = lws.cell(row=row, column=lh["Season"]).value

        values = {}
        for f in FIELDS:
            v = lws.cell(row=row, column=lh[f]).value
            values[f] = str(v).strip() if v is not None else ""

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

    print(f"\n{scanned} rows scanned in '{SHEET_NAME}'.")
    print(f"Players sheet cells written: {updated_players}")
    print(f"PlayerSeasons sheet cells written: {updated_seasons}")
    print(f"Rows with nothing filled in (skipped): {skipped_blank_input}")
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
