"""One-time cleanup pass on WomensSummitTPE.xlsx before real scraping starts.

What this does, in order:

1. Teams sheet: assigns a stable numeric "Team ID" to every row (used
   as the foreign key everywhere else), and adds tracking columns
   (ESPN Team ID, Scrape Status, Last Scraped Season, Scrape Error,
   Last Updated) so the scrapers can skip teams they've already
   finished and retry ones that failed.
2. Teams sheet: rebuilds the "Record" column from Wins/Losses as
   clean text ("23-11"). The existing values were corrupted by Excel
   auto-converting text like "7-24" into literal dates (Akron showed
   up as 2026-07-24 instead of a 7-24 record) -- rebuilding from
   Wins/Losses sidesteps needing to reverse-engineer each corrupted
   value, and the column gets formatted as Text going forward so it
   can't happen again.
3. Players / PlayerGameStats / Games: wipes all data rows. The
   Players sheet currently holds ~9,954 rows of men's data left over
   from HoopSourceStats.xlsx (Team IDs referencing that workbook's
   numbering, not this one) -- not real women's data, so it needs to
   go before we load the real thing.
4. PlayerGameStats: names its two unlabeled trailing columns "Game ID"
   and "Season" (they existed but were blank headers) so game stats
   can be joined back to the Games table and filtered by season.
5. Games: adds an "Away Team" name column (previously only Away Team
   ID existed, with no matching name column -- Home Team had one).
6. PlayerSeasons: this sheet existed but was completely empty (no
   headers). Defines it as the season-by-season snapshot table
   (a player's team/position/class can change year to year, which a
   single Players row can't capture) and gives it headers.

Run this once, before scraping. It's safe to re-run -- re-running
just re-derives Team ID assignments (stable, based on row order) and
re-wipes any data that was reloaded, so don't run it *after* you've
scraped real data unless you mean to start over.

Usage:
    python scrapers/cleanup_workbook.py [path-to-xlsx]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import ensure_columns, header_map, open_workbook, save_with_retry, wipe_data_rows

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")

TEAMS_NEW_COLUMNS = [
    "Team ID",
    "ESPN Team ID",
    "Scrape Status",
    "Last Scraped Season",
    "Scrape Error",
    "Last Updated",
]

PLAYER_SEASONS_HEADERS = [
    "Player ID",
    "Season",
    "Team ID",
    "Division",
    "Position",
    "Height",
    "Class",
    "Games Played",
    "Games Started",
    "Finished",
]


def fix_teams_sheet(wb):
    ws = wb["Teams"]
    hmap = ensure_columns(ws, TEAMS_NEW_COLUMNS)

    team_col = hmap["Team ID"]
    wins_col = hmap["Wins"]
    losses_col = hmap["Losses"]
    record_col = hmap["Record"]
    status_col = hmap["Scrape Status"]

    # Text number format so Excel never again reinterprets "7-24" as a date.
    for row in range(2, ws.max_row + 1):
        ws.cell(row=row, column=record_col).number_format = "@"

    next_id = 1
    fixed_records = 0
    for row in range(2, ws.max_row + 1):
        team_name = ws.cell(row=row, column=hmap["Team"]).value
        if not team_name:
            continue

        # Assign a Team ID if this row doesn't already have one.
        existing_id = ws.cell(row=row, column=team_col).value
        if not existing_id:
            ws.cell(row=row, column=team_col, value=next_id)
        next_id = max(next_id, (existing_id or 0)) + 1

        wins = ws.cell(row=row, column=wins_col).value or 0
        losses = ws.cell(row=row, column=losses_col).value or 0
        ws.cell(row=row, column=record_col, value=f"{int(wins)}-{int(losses)}")
        fixed_records += 1

        if not ws.cell(row=row, column=status_col).value:
            ws.cell(row=row, column=status_col, value="Not Started")

    print(f"Teams: assigned/verified Team IDs, rebuilt {fixed_records} Record values, "
          f"added tracking columns.")
    return hmap


def wipe_stale_data(wb):
    for name in ["Players", "PlayerGameStats", "Games"]:
        before = wb[name].max_row
        wipe_data_rows(wb, name)
        print(f"{name}: wiped {max(0, before - 1)} stale data rows (header kept).")


def label_playergamestats_trailing_columns(wb):
    ws = wb["PlayerGameStats"]
    hmap = header_map(ws)
    # These two columns exist (max_column already includes them) but
    # have blank headers -- name them in place rather than appending
    # new columns at the end.
    if "Game ID" not in hmap:
        ws.cell(row=1, column=24, value="Game ID")
    if "Season" not in hmap:
        ws.cell(row=1, column=25, value="Season")
    print("PlayerGameStats: labeled trailing columns as 'Game ID' and 'Season'.")


def add_games_away_team_name(wb):
    ws = wb["Games"]
    ensure_columns(ws, ["Away Team"])
    print("Games: added 'Away Team' name column (only the ID existed before).")


def define_player_seasons_sheet(wb):
    ws = wipe_data_rows(wb, "PlayerSeasons", keep_header=False)
    for col, name in enumerate(PLAYER_SEASONS_HEADERS, start=1):
        ws.cell(row=1, column=col, value=name)
    print("PlayerSeasons: defined headers (was completely empty before).")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    print(f"Opening {path} ...")
    wb = open_workbook(path)

    fix_teams_sheet(wb)
    wipe_stale_data(wb)
    label_playergamestats_trailing_columns(wb)
    add_games_away_team_name(wb)
    define_player_seasons_sheet(wb)

    print("Saving ...")
    save_with_retry(wb, path)
    print("Done.")


if __name__ == "__main__":
    main()
