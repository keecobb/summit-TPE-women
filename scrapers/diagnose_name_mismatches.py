"""Diagnose why enrich_position_height_class.py patched 0 (or few) rows for
teams whose roster fetch actually SUCCEEDED (follow-up to task #57).

Context: in the 2025-26 D2 enrichment run, many teams matched 100% of
their target rows (American International 13/13, Indianapolis 12/12,
Moorhead State 14/14) while ~90 others matched 0% despite the roster
fetch NOT erroring out (Azusa Pacific 0/12, Cal State Dominguez Hills
0/41, Adams State 0/3, and more). A real roster page doesn't have every
single field missing for every single player -- this is almost certainly
the same class of bug already fixed twice this session for TEAM names
(format/collision mismatches), just for PLAYER names this time: the
matcher can't line up "First Last" from the Players sheet against
however that team's roster page spells it (nicknames, suffixes like
Jr./II, accented characters that normalize_text() silently DROPS rather
than transliterates, middle names, etc).

This script re-fetches ONE team's roster (same client, same URL, zero
new scraping infrastructure, read-only -- never touches the workbook)
and prints both name lists side by side, plus a best-guess closest match
for anything that didn't line up exactly, so the real mismatch pattern
can be seen and fixed with evidence instead of guessed at.

Usage:
    python scrapers/diagnose_name_mismatches.py "Azusa Pacific"
    python scrapers/diagnose_name_mismatches.py --all-zero --limit 15
"""

import argparse
import difflib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from enrich_position_height_class import fetch_roster_by_name
from run_d2_scrape import normalize_name_key
from scrapers.xlsx_io import header_map, open_workbook

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def load_team_and_targets(wb, season, team_name_filter=None):
    tws = wb["Teams"]
    th = header_map(tws)
    team_info = {}
    for row in range(2, tws.max_row + 1):
        tid = tws.cell(row=row, column=th["Team ID"]).value
        if tid is None:
            continue
        name = tws.cell(row=row, column=th["Team"]).value
        if team_name_filter and (name or "").strip().lower() != team_name_filter.strip().lower():
            continue
        team_info[tid] = {
            "name": name,
            "roster_url": tws.cell(row=row, column=th["Roster URL"]).value,
            "site_type": tws.cell(row=row, column=th["SiteType"]).value,
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
    targets_by_team = {}
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
        if tid not in team_info:
            continue
        first, last = player_names.get(pid, ("", ""))
        targets_by_team.setdefault(tid, []).append((pid, first, last))

    return team_info, targets_by_team


def diagnose_team(info, targets, season):
    print(f"\n=== {info['name']} ({info.get('site_type')}) ===")
    try:
        by_name = fetch_roster_by_name(info, season)
    except Exception as exc:
        print(f"  [!] fetch failed: {exc}")
        return

    roster_keys = sorted(by_name.keys())
    print(f"  Roster page returned {len(roster_keys)} players:")
    for k in roster_keys:
        print(f"    roster: {k!r}")

    print(f"  {len(targets)} target rows in Players/PlayerSeasons:")
    for pid, first, last in targets:
        key = normalize_name_key(f"{first} {last}")
        hit = "MATCH" if key in by_name else "no match"
        line = f"    target: {first!r} {last!r} -> key {key!r}  [{hit}]"
        if hit == "no match":
            close = difflib.get_close_matches(key, roster_keys, n=2, cutoff=0.6)
            if close:
                line += f"   closest roster key(s): {close}"
        print(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("team", nargs="?", help="Exact Team name (as stored in the Teams sheet) to diagnose")
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--all-zero", action="store_true",
                         help="Diagnose the teams with the most target rows (one live fetch "
                              "each -- can be slow). Use this to scan for the mismatch pattern "
                              "across several teams at once instead of one at a time.")
    parser.add_argument("--limit", type=int, default=15, help="Max teams to check with --all-zero")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()

    if not args.team and not args.all_zero:
        parser.error("pass a team name, or --all-zero")

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    if args.team:
        team_info, targets_by_team = load_team_and_targets(wb, args.season, team_name_filter=args.team)
        if not team_info:
            print(f"No team found matching {args.team!r}")
            return
        for tid, info in team_info.items():
            diagnose_team(info, targets_by_team.get(tid, []), args.season)
        return

    team_info, targets_by_team = load_team_and_targets(wb, args.season)
    checked = 0
    for tid, targets in sorted(targets_by_team.items(), key=lambda kv: -len(kv[1])):
        if checked >= args.limit:
            break
        info = team_info.get(tid)
        if not info or not info.get("roster_url"):
            continue
        diagnose_team(info, targets, args.season)
        checked += 1


if __name__ == "__main__":
    main()
