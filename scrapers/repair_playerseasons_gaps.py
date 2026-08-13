"""One-off repair: backfill blank Position (and Height/Class, opportunistically)
on existing PlayerSeasons rows for D2 teams whose season WAS successfully
scraped (they have real games in the Games sheet as the home team for that
season) but whose PlayerSeasons row still shows a blank Position.

Root cause (now fixed going forward in run_d2_scrape.py's finalize(), see
its comment there): Position is only ever known at the moment a player is
matched against THEIR OWN team's roster while processing that team's own
box scores -- never on the "opponent" side of someone else's box score,
and never stored anywhere in PlayerGameStats itself. Before the fix, any
run that touched a player's (Player ID, Season) key ONLY via an opponent
sighting (no game from their own team's scrape touched in that same run --
e.g. because their own team was already marked "Done" and got skipped)
would aggregate Position as blank and silently overwrite a previously
correct value with nothing, since the old write had no fallback to what
was already in the sheet (unlike Height/Class, which already did).

That finalize() fix stops it from happening again, but doesn't recover
data that's already been blanked out. Since Position isn't stored in
PlayerGameStats at all, the only way to recover it is a live re-fetch of
each affected team's own season roster -- much cheaper than a full team
rescrape (one roster request instead of a schedule + dozens of box
scores), and it doesn't touch Games/PlayerGameStats at all, so there's no
duplicate-game risk from re-running this.

Usage:
    python scrapers/repair_playerseasons_gaps.py
    python scrapers/repair_playerseasons_gaps.py --dry-run
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm
from run_d2_scrape import normalize_class, normalize_height, normalize_name_key, site_base_url
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
SLEEP_BETWEEN_TEAMS = 0.5


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without saving")
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    teams_ws = wb["Teams"]
    th = header_map(teams_ws)
    team_id_to_row = {}
    for row in range(2, teams_ws.max_row + 1):
        tid = teams_ws.cell(row=row, column=th["Team ID"]).value
        if tid is None:
            continue
        team_id_to_row[tid] = {
            "name": teams_ws.cell(row=row, column=th["Team"]).value,
            "roster_url": teams_ws.cell(row=row, column=th["Roster URL"]).value,
            "site_type": teams_ws.cell(row=row, column=th["SiteType"]).value,
        }

    games_ws = wb["Games"]
    gh = header_map(games_ws)
    home_team_season = set()
    for row in games_ws.iter_rows(min_row=2, values_only=True):
        home_team_season.add((row[gh["Home Team ID"] - 1], row[gh["Season"] - 1]))

    players_ws = wb["Players"]
    ph = header_map(players_ws)
    player_names = {}  # player_id -> (first, last)
    for row in players_ws.iter_rows(min_row=2, values_only=True):
        pid = row[ph["Player ID"] - 1]
        if pid is None:
            continue
        player_names[pid] = (row[ph["First Name"] - 1] or "", row[ph["Last Name"] - 1] or "")

    seasons_ws = wb["PlayerSeasons"]
    sh = header_map(seasons_ws)
    col_pid = sh["Player ID"]
    col_season = sh["Season"]
    col_team = sh["Team ID"]
    col_div = sh["Division"]
    col_pos = sh["Position"]
    col_height = sh["Height"]
    col_class = sh["Class"]

    # Group blank-Position rows by (team_id, season) so each team's
    # roster only gets fetched once no matter how many of its players
    # need a patch.
    groups = {}
    for row in range(2, seasons_ws.max_row + 1):
        pid = seasons_ws.cell(row=row, column=col_pid).value
        if pid is None:
            continue
        if seasons_ws.cell(row=row, column=col_div).value != "D2":
            continue
        pos = seasons_ws.cell(row=row, column=col_pos).value
        if pos:
            continue
        tid = seasons_ws.cell(row=row, column=col_team).value
        season = seasons_ws.cell(row=row, column=col_season).value
        if (tid, season) not in home_team_season:
            # Never actually scraped as itself this season -- blank
            # Position here is correct/expected (opponent-only sighting,
            # e.g. a team whose own Roster URL is broken), not a gap.
            continue
        groups.setdefault((tid, season), []).append(row)

    print(f"{len(groups)} (team, season) pairs need a Position refresh "
          f"({sum(len(v) for v in groups.values())} PlayerSeasons rows total).")

    patched_rows = 0
    patched_teams = 0
    failed_teams = []
    for i, ((tid, season), rows) in enumerate(sorted(groups.items()), start=1):
        info = team_id_to_row.get(tid)
        if not info or not info.get("roster_url") or str(info.get("site_type") or "").strip().lower() != "sidearm":
            failed_teams.append((tid, season, "no usable Roster URL/SiteType"))
            continue

        print(f"[{i}/{len(groups)}] {info['name']} {season} ({len(rows)} rows to check) ...")
        base_url, sport_path = site_base_url(info["roster_url"])
        roster_url = f"{base_url}/{sport_path}/roster"
        try:
            roster = sidearm.get_roster(roster_url, season_path=season)
        except sidearm.SidearmError as exc:
            print(f"    [!] roster fetch failed: {exc}")
            failed_teams.append((tid, season, str(exc)))
            time.sleep(SLEEP_BETWEEN_TEAMS)
            continue

        by_name = {}
        for p in roster:
            by_name[normalize_name_key(p["name"])] = p

        team_patched = 0
        for row in rows:
            pid = seasons_ws.cell(row=row, column=col_pid).value
            first, last = player_names.get(pid, ("", ""))
            key = normalize_name_key(f"{first} {last}")
            entry = by_name.get(key)
            if not entry:
                continue
            position = entry.get("position")
            height = normalize_height(entry.get("height"))
            class_year = normalize_class(entry.get("class_year"))
            if position and not args.dry_run:
                seasons_ws.cell(row=row, column=col_pos, value=position)
            if height and not seasons_ws.cell(row=row, column=col_height).value and not args.dry_run:
                seasons_ws.cell(row=row, column=col_height, value=height)
            if class_year and not seasons_ws.cell(row=row, column=col_class).value and not args.dry_run:
                seasons_ws.cell(row=row, column=col_class, value=class_year)
            if position:
                team_patched += 1
                patched_rows += 1

        print(f"    patched {team_patched}/{len(rows)} rows")
        if team_patched:
            patched_teams += 1
        time.sleep(SLEEP_BETWEEN_TEAMS)

    print()
    print(f"Done. Patched {patched_rows} PlayerSeasons rows across {patched_teams} teams.")
    if failed_teams:
        print(f"{len(failed_teams)} (team, season) pairs could not be refreshed (roster fetch failed or missing URL):")
        for tid, season, reason in failed_teams:
            name = team_id_to_row.get(tid, {}).get("name", tid)
            print(f"    {name} {season}: {reason}")

    if args.dry_run:
        print("Dry run -- no changes saved.")
        return

    print("Saving ...")
    save_with_retry(wb, args.path)
    print("Saved.")


if __name__ == "__main__":
    main()
