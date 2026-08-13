"""Fill in missing Position/Height/Class for D1 (ESPN-sourced) players --
the counterpart to enrich_position_height_class.py, which only covers
Sidearm/Presto (D2) sites since it keys off the Teams sheet's "Roster
URL" column, which D1 rows never populate (D1 goes through ESPN's API
instead, keyed by "ESPN Team ID").

Context: after task #54's audit, 703 D1 PlayerSeasons rows for 2025-26
were missing >=1 of Position/Height/Class, all skipped by the D2
enrichment script for exactly that reason.

Two-tier recovery, both far more reliable than D2's name-matching
because ESPN athlete IDs are stable and already stored on every ESPN-
sourced Players row (in "External ID", populated by run_d1_scrape.py's
original scrape):

  1. Team-roster match (Position + Height + Class): fetch each affected
     team's CURRENT ESPN roster ONCE (espn_client.get_roster) and match
     by External ID -- exact ID match, not name-matching, so no
     ambiguity risk at all. Only works for players still on their
     team's roster as of today.
  2. Athlete-profile fallback (Height only): for players not found on
     their team's current roster (graduated, transferred out since the
     season ended -- expected for a lot of these, since today is deep
     in the 2025-26 off-season), espn_client.get_athlete_height() looks
     up a fixed physical attribute by athlete ID directly, independent
     of any current roster. Confirmed by that function's own docstring
     to work even for departed players. Doesn't recover Position/Class
     (ESPN has no season-tied endpoint for a departed player's
     experience/position), so those two may still end up on the
     manual-entry list even after this pass.

Whatever's still missing after both tiers goes to
outputs/needs_manual_position_data_d1.csv, same shape as the D2 script's
output file.

Usage:
    python scrapers/enrich_d1_position_height_class.py                # season=2025-26, report + fetch, no save
    python scrapers/enrich_d1_position_height_class.py --write         # also save changes to the workbook
"""

import argparse
import csv
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers.espn_client as espn
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
SLEEP_BETWEEN_TEAMS = 0.4
OUTPUT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "needs_manual_position_data_d1.csv")


def season_to_espn_year(season_label):
    """"2025-26" -> 2026 -- ESPN's season int is the year the season
    ENDS in, matching run_d1_scrape.py's season_label()/DEFAULT_SEASONS
    convention exactly (kept in sync deliberately)."""
    start_year = int(season_label.split("-")[0])
    return start_year + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--write", action="store_true", help="Save changes to the workbook (without this, fetches and reports only)")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()
    season = args.season
    espn_season = season_to_espn_year(season)

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
            "espn_id": tws.cell(row=row, column=th["ESPN Team ID"]).value,
            "division": tws.cell(row=row, column=th["Division"]).value,
        }

    pws = wb["Players"]
    ph = header_map(pws)
    player_row_by_id = {}
    external_id_by_pid = {}
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid is None:
            continue
        player_row_by_id[pid] = row
        external_id_by_pid[pid] = pws.cell(row=row, column=ph["External ID"]).value

    psws = wb["PlayerSeasons"]
    psh = header_map(psws)

    groups = {}          # team_id -> [row, ...]
    all_targets = []      # (row, pid, tid)
    for row in range(2, psws.max_row + 1):
        pid = psws.cell(row=row, column=psh["Player ID"]).value
        if pid is None:
            continue
        if psws.cell(row=row, column=psh["Season"]).value != season:
            continue
        if psws.cell(row=row, column=psh["Division"]).value != "D1":
            continue
        pos = psws.cell(row=row, column=psh["Position"]).value
        ht = psws.cell(row=row, column=psh["Height"]).value
        cls = psws.cell(row=row, column=psh["Class"]).value
        if pos and ht and cls:
            continue
        tid = psws.cell(row=row, column=psh["Team ID"]).value
        all_targets.append((row, pid, tid))
        info = team_info.get(tid)
        if info and info.get("espn_id"):
            groups.setdefault(tid, []).append(row)

    print(f"{len(all_targets)} D1 PlayerSeasons rows for {season} missing >=1 of Position/Height/Class.")
    print(f"{len(groups)} teams have a known ESPN Team ID and can be checked "
          f"({sum(len(v) for v in groups.values())} of those rows).")

    patched_rows = 0
    fetch_failed = []
    filled_pids = set()
    height_fallback_used = 0

    for i, (tid, rows) in enumerate(sorted(groups.items()), start=1):
        info = team_info[tid]
        print(f"[{i}/{len(groups)}] {info['name']} ({len(rows)} rows) ...")
        try:
            roster = espn.get_roster(info["espn_id"], season=espn_season)
        except espn.EspnError as exc:
            print(f"    [!] roster fetch failed: {exc}")
            fetch_failed.append((tid, info["name"], str(exc)))
            time.sleep(SLEEP_BETWEEN_TEAMS)
            continue

        by_external_id = {str(p["espn_athlete_id"]): p for p in roster if p.get("espn_athlete_id")}

        team_patched = 0
        for row in rows:
            pid = psws.cell(row=row, column=psh["Player ID"]).value
            ext_id = external_id_by_pid.get(pid)
            changed = False

            entry = by_external_id.get(str(ext_id)) if ext_id else None
            if entry:
                position = entry.get("position")
                height = entry.get("height")
                class_year = entry.get("class_year")
                if position and not psws.cell(row=row, column=psh["Position"]).value:
                    psws.cell(row=row, column=psh["Position"], value=position)
                    changed = True
                if height and not psws.cell(row=row, column=psh["Height"]).value:
                    psws.cell(row=row, column=psh["Height"], value=height)
                    changed = True
                if class_year and not psws.cell(row=row, column=psh["Class"]).value:
                    psws.cell(row=row, column=psh["Class"], value=class_year)
                    changed = True

                prow = player_row_by_id.get(pid)
                if prow:
                    if position and not pws.cell(row=prow, column=ph["Position"]).value:
                        pws.cell(row=prow, column=ph["Position"], value=position)
                        changed = True
                    if height and not pws.cell(row=prow, column=ph["Height"]).value:
                        pws.cell(row=prow, column=ph["Height"], value=height)
                        changed = True
                    if class_year and not pws.cell(row=prow, column=ph["Class"]).value:
                        pws.cell(row=prow, column=ph["Class"], value=class_year)
                        changed = True
            else:
                # Not on the CURRENT roster (graduated/transferred out) --
                # fall back to the athlete-profile endpoint for Height
                # only (see module docstring for why Position/Class
                # can't be recovered this way).
                if ext_id and not psws.cell(row=row, column=psh["Height"]).value:
                    height = espn.get_athlete_height(ext_id)
                    if height:
                        psws.cell(row=row, column=psh["Height"], value=height)
                        prow = player_row_by_id.get(pid)
                        if prow and not pws.cell(row=prow, column=ph["Height"]).value:
                            pws.cell(row=prow, column=ph["Height"], value=height)
                        changed = True
                        height_fallback_used += 1

            if changed:
                team_patched += 1
                patched_rows += 1
                filled_pids.add(pid)

        print(f"    patched {team_patched}/{len(rows)} rows")
        time.sleep(SLEEP_BETWEEN_TEAMS)

    print(f"\nPatched {patched_rows} PlayerSeasons rows across {len(groups) - len(fetch_failed)} teams "
          f"({height_fallback_used} via the departed-player Height-only fallback).")
    if fetch_failed:
        print(f"{len(fetch_failed)} teams' roster fetch failed:")
        for tid, name, reason in fetch_failed:
            print(f"    {name}: {reason}")

    remaining = []
    for row, pid, tid in all_targets:
        pos = psws.cell(row=row, column=psh["Position"]).value
        ht = psws.cell(row=row, column=psh["Height"]).value
        cls = psws.cell(row=row, column=psh["Class"]).value
        if pos and ht and cls:
            continue
        first = pws.cell(row=player_row_by_id.get(pid, 0), column=ph["First Name"]).value if pid in player_row_by_id else None
        last = pws.cell(row=player_row_by_id.get(pid, 0), column=ph["Last Name"]).value if pid in player_row_by_id else None
        info = team_info.get(tid, {})
        # Position/Height/Class left BLANK (not a flag) -- this file
        # doubles as the fill-in template for
        # import_manual_position_data.py; a pre-existing value is
        # carried through so import never accidentally blanks it.
        remaining.append({
            "Player ID": pid, "First Name": first, "Last Name": last,
            "Team": info.get("name") or tid, "Season": season,
            "ESPN Team ID": info.get("espn_id") or "",
            "Position": pos or "", "Height": ht or "", "Class": cls or "",
        })

    out_path = os.path.abspath(OUTPUT_CSV)
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "Player ID", "First Name", "Last Name", "Team", "Season", "ESPN Team ID",
            "Position", "Height", "Class",
        ])
        writer.writeheader()
        writer.writerows(remaining)

    print(f"\n{len(remaining)} rows still need manual entry after this pass -- written to {out_path} "
          f"(fill in the blank Position/Height/Class cells and import back with "
          f"scrapers/import_manual_position_data.py)")

    if not args.write:
        print("\n--write not passed: fetched and reported only, workbook NOT modified.")
        return

    if patched_rows == 0:
        print("\nNothing to save.")
        return

    print("\nSaving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
