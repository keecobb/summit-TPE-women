"""Fill in missing Position/Height/Class for a season (default: 2025-26).

Context: an audit (task #50-54) found 3,830 PlayerSeasons rows for
2025-26 missing Position AND Height AND Class entirely. 3,285 of those
(86%) turned out to be a DOWNSTREAM effect of the "-1 Team ID" opponent-
resolution bug that audit_players_and_stats.py already fixes: when a
player's own team_id was unknown at scrape time, we never even attempted
to look them up on their own team's roster page, so Position/Height/Class
were never captured -- not because the site lacks them, but because we
never went looking on the right site. The other 545 are players on a
KNOWN team whose own roster fetch genuinely came back without those
columns for them (this is task #30's already-accepted trade-off: the
roster parser accepts a table missing Class OR Height rather than
rejecting the whole roster).

This script re-fetches each affected team's CURRENT season roster ONCE
(grouped, not once per player) and fills in any blank Position/Height/
Class by matching on name -- on BOTH the PlayerSeasons row for this
season AND the master Players sheet row (only ever filling a blank,
never overwriting an existing value, same safety rule as
repair_playerseasons_gaps.py). Works for both Sidearm and Presto sites.

IMPORTANT: run `python scrapers/audit_players_and_stats.py --write`
FIRST. That backfills real Team IDs for ~1,195 players who currently
show Team ID == -1 -- this script can only chase a team's roster once it
knows which team that is, so running the Team ID repair first directly
increases how many players this script can recover.

Whatever is STILL missing after the live re-fetch (site genuinely
doesn't expose it, or the fetch failed) gets written to
outputs/needs_manual_position_data.csv -- name, team, Season, which
field(s) are missing, and the team's Roster URL, so it can be looked up
by hand (MaxPreps, the team's official site, etc.) and typed in.

Usage:
    python scrapers/enrich_position_height_class.py                # season=2025-26, report + fetch, no save
    python scrapers/enrich_position_height_class.py --write         # also save changes to the workbook
    python scrapers/enrich_position_height_class.py --season 2024-25 --write
"""

import argparse
import csv
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import presto_client as presto
import sidearm_client as sidearm
from run_d2_scrape import normalize_class, normalize_height, normalize_name_key, site_base_url
from run_d2_presto_scrape import presto_url_parts, roster_url as presto_roster_url
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
SLEEP_BETWEEN_TEAMS = 0.5
OUTPUT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "needs_manual_position_data.csv")


def fetch_roster_by_name(info, season):
    """Returns {normalized_name_key: {'position', 'height', 'class_year'}} or raises."""
    site_type = str(info.get("site_type") or "").strip().lower()
    roster_url_stored = info.get("roster_url")
    if not roster_url_stored:
        raise RuntimeError("no Roster URL on file")

    if site_type == "sidearm":
        base_url, sport_path = site_base_url(roster_url_stored)
        url = f"{base_url}/{sport_path}/roster"
        roster = sidearm.get_roster(url, season_path=season)
    elif site_type == "presto":
        base_url, sport_code, _slug, _hub = presto_url_parts(roster_url_stored)
        if not sport_code:
            raise RuntimeError("could not parse sport code from stored Roster URL")
        url = presto_roster_url(base_url, sport_code, season)
        roster = presto.get_roster(url)
    else:
        raise RuntimeError(f"unsupported SiteType {site_type!r}")

    by_name = {}
    for p in roster:
        key = normalize_name_key(p["name"])
        by_name[key] = {
            "position": p.get("position"),
            "height": normalize_height(p.get("height")),
            "class_year": normalize_class(p.get("class_year")),
        }
    return by_name


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--write", action="store_true", help="Save changes to the workbook (without this, fetches and reports only)")
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
            "roster_url": tws.cell(row=row, column=th["Roster URL"]).value,
            "site_type": tws.cell(row=row, column=th["SiteType"]).value,
        }

    pws = wb["Players"]
    ph = header_map(pws)
    player_names = {}
    player_row_by_id = {}
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid is None:
            continue
        player_names[pid] = (
            pws.cell(row=row, column=ph["First Name"]).value or "",
            pws.cell(row=row, column=ph["Last Name"]).value or "",
        )
        player_row_by_id[pid] = row

    psws = wb["PlayerSeasons"]
    psh = header_map(psws)

    # Group target rows by team_id -- only teams with a real (non -1,
    # known-to-Teams-sheet) Team ID are chaseable at all.
    groups = {}
    all_targets = []  # (row, pid, tid) for every row missing >=1 field this season
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
        all_targets.append((row, pid, tid))
        if tid is not None and tid != -1 and tid in team_info:
            groups.setdefault(tid, []).append(row)

    print(f"{len(all_targets)} PlayerSeasons rows for {season} missing >=1 of Position/Height/Class.")
    print(f"{len(groups)} teams have a known Team ID and can be re-fetched "
          f"({sum(len(v) for v in groups.values())} of those rows).")
    still_unresolvable_team = len(all_targets) - sum(len(v) for v in groups.values())
    print(f"{still_unresolvable_team} rows have no usable Team ID (still -1 or fully orphaned) -- "
          f"can't be chased until they resolve via audit_players_and_stats.py.")

    patched_rows = 0
    fetch_failed = []
    filled_pids = set()

    for i, (tid, rows) in enumerate(sorted(groups.items()), start=1):
        info = team_info[tid]
        print(f"[{i}/{len(groups)}] {info['name']} ({info.get('site_type')}, {len(rows)} rows) ...")
        try:
            by_name = fetch_roster_by_name(info, season)
        except Exception as exc:
            print(f"    [!] fetch failed: {exc}")
            fetch_failed.append((tid, info["name"], str(exc)))
            time.sleep(SLEEP_BETWEEN_TEAMS)
            continue

        team_patched = 0
        for row in rows:
            pid = psws.cell(row=row, column=psh["Player ID"]).value
            first, last = player_names.get(pid, ("", ""))
            entry = by_name.get(normalize_name_key(f"{first} {last}"))
            if not entry:
                continue

            changed = False
            for sheet_ws, hmap, col_pos, col_ht, col_cls, target_row in (
                (psws, psh, psh["Position"], psh["Height"], psh["Class"], row),
            ):
                if entry["position"] and not sheet_ws.cell(row=target_row, column=col_pos).value:
                    sheet_ws.cell(row=target_row, column=col_pos, value=entry["position"])
                    changed = True
                if entry["height"] and not sheet_ws.cell(row=target_row, column=col_ht).value:
                    sheet_ws.cell(row=target_row, column=col_ht, value=entry["height"])
                    changed = True
                if entry["class_year"] and not sheet_ws.cell(row=target_row, column=col_cls).value:
                    sheet_ws.cell(row=target_row, column=col_cls, value=entry["class_year"])
                    changed = True

            # Also backfill the master Players sheet row (only blanks).
            prow = player_row_by_id.get(pid)
            if prow:
                if entry["position"] and not pws.cell(row=prow, column=ph["Position"]).value:
                    pws.cell(row=prow, column=ph["Position"], value=entry["position"])
                    changed = True
                if entry["height"] and not pws.cell(row=prow, column=ph["Height"]).value:
                    pws.cell(row=prow, column=ph["Height"], value=entry["height"])
                    changed = True
                if entry["class_year"] and not pws.cell(row=prow, column=ph["Class"]).value:
                    pws.cell(row=prow, column=ph["Class"], value=entry["class_year"])
                    changed = True

            if changed:
                team_patched += 1
                patched_rows += 1
                filled_pids.add(pid)

        print(f"    patched {team_patched}/{len(rows)} rows")
        time.sleep(SLEEP_BETWEEN_TEAMS)

    print(f"\nPatched {patched_rows} PlayerSeasons rows across {len(groups) - len(fetch_failed)} teams.")
    if fetch_failed:
        print(f"{len(fetch_failed)} teams' roster re-fetch failed:")
        for tid, name, reason in fetch_failed:
            print(f"    {name}: {reason}")

    # ---- Build the "still needs manual entry" worklist ----
    remaining = []
    for row, pid, tid in all_targets:
        if pid in filled_pids:
            # re-check: might still be partially missing if roster only had some fields
            pos = psws.cell(row=row, column=psh["Position"]).value
            ht = psws.cell(row=row, column=psh["Height"]).value
            cls = psws.cell(row=row, column=psh["Class"]).value
            if pos and ht and cls:
                continue
        pos = psws.cell(row=row, column=psh["Position"]).value
        ht = psws.cell(row=row, column=psh["Height"]).value
        cls = psws.cell(row=row, column=psh["Class"]).value
        first, last = player_names.get(pid, ("", ""))
        info = team_info.get(tid, {})
        # Position/Height/Class deliberately left BLANK here (not a "Missing: X"
        # flag) -- this file doubles as the fill-in template for
        # import_manual_position_data.py. A pre-existing value (one of
        # the 3 fields already resolved) is carried through as-is so you
        # don't accidentally blank it out on import; only truly blank
        # cells need typing in.
        remaining.append({
            "Player ID": pid, "First Name": first, "Last Name": last,
            "Team": info.get("name") or ("UNRESOLVED (-1)" if tid == -1 else tid),
            "Season": season,
            "Roster URL": info.get("roster_url") or "",
            "Position": pos or "", "Height": ht or "", "Class": cls or "",
        })

    out_path = os.path.abspath(OUTPUT_CSV)
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "Player ID", "First Name", "Last Name", "Team", "Season", "Roster URL",
            "Position", "Height", "Class",
        ])
        writer.writeheader()
        writer.writerows(remaining)

    print(f"\n{len(remaining)} rows still need manual entry after this pass -- written to {out_path}")
    print("(includes players still stuck on an unresolved Team ID -- rerun "
          "audit_players_and_stats.py --write again later as more opponent "
          "names resolve, then rerun this script to shrink the list further. "
          "Fill in the blank Position/Height/Class cells and import back with "
          "scrapers/import_manual_position_data.py)")

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
