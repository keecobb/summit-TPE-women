"""Main D1 scraper: rosters, schedules, and full box scores for every
D1 team across the target seasons, written into WomensSummitTPE.xlsx.

Run scrapers/team_match.py first so Teams.'ESPN Team ID' is filled in
for D1 rows -- teams without one are skipped here.

Resumability: progress is tracked on the Teams sheet itself
(Scrape Status / Last Scraped Season / Scrape Error), and every game
already written (by Game ID) is skipped, so:
  - stopping and re-running continues where it left off instead of
    re-scraping everything
  - a team that errored gets retried on the next run instead of
    silently staying incomplete
  - a game that showed up in both teams' schedules only gets written
    (and its box score only fetched) once

Player identity across seasons/schools: every player is keyed by her
ESPN athlete ID (stable across a transfer -- ESPN doesn't issue a new
ID when someone changes schools), so the same person never gets a
second Player ID just because she played for two different teams
across the 3 seasons. Players.'Team ID' always reflects her CURRENT
team (see finalize_players() below) -- her season-by-season history,
including any transfer, lives in the PlayerSeasons sheet, one row per
player per season with that season's actual team.

Height/Class: ESPN only exposes the CURRENT season's roster (its
historical roster endpoint returns nothing for past years -- verified
directly against the live API before writing this), and box scores
don't include height/class at all. So:
  - Height doesn't change season to season, so once we know it (from
    whichever team's current roster lists her) we backfill it onto
    every one of her PlayerSeasons rows, including past seasons.
  - Class (FR/SO/JR/SR) DOES change year to year, so it only gets
    filled in for the season that matches the roster snapshot we
    fetched (normally the most recent one). Older seasons' Class is
    left blank rather than guessed -- ESPN just doesn't give us that
    history.
  - A player who already graduated or left Division I before the
    current season won't appear on anyone's current roster, so her
    Height/Class stay blank here. (ESPN also has a separate per-athlete
    endpoint -- espn_client.get_athlete_height() -- that can fill in
    Height for these players regardless of roster status; intentionally
    run as a separate manual pass rather than automatically in this
    script, since it's one HTTP request per player and can be slow.)

Usage:
    python scrapers/run_d1_scrape.py
    python scrapers/run_d1_scrape.py --seasons 2024 2025 2026
    python scrapers/run_d1_scrape.py --only "Duke,South Carolina"
"""

import argparse
import datetime
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers.espn_client as espn
from scrapers.xlsx_io import (
    ensure_columns, header_map, iter_data_rows, open_workbook, save_with_retry,
    wipe_data_rows,
)

# Bump this every time this file is edited -- printed at the start of
# every run so it's obvious at a glance (without checking file
# properties/git) whether you're running the version with the latest
# fixes. Format: YYYY-MM-DD HH:MM PST/PDT, the date+time of the most
# recent edit (date alone wasn't enough -- multiple fixes can land on
# the same day). Not bumped right now since this file itself wasn't
# touched in that session -- only run_d2_scrape.py/sidearm_client.py
# were.
LAST_REVISED = "2026-07-26"

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
DEFAULT_SEASONS = [2024, 2025, 2026]  # ESPN "season" = the year the season ends in
CHECKPOINT_EVERY = 8                  # save the workbook every N teams
SLEEP_BETWEEN_TEAMS = 0.4             # politeness delay, seconds

PLAYER_NEW_COLUMNS = ["External ID", "Source", "Division", "Transfer History", "Schools Attended"]
# Written to PlayerGameStats alongside the usual stat columns so the
# per-season Division/Position a player was recorded under lives on the
# durable, append-only sheet itself -- not just in this run's in-memory
# season_agg. That's what lets finalize_players() rebuild PlayerSeasons
# from the COMPLETE PlayerGameStats history (every team, every prior
# run) instead of only the teams reprocessed this run. See the
# "PlayerSeasons rebuild source" note on finalize_players() for why this
# matters.
PGS_NEW_COLUMNS = ["Position", "Division"]
# Full header set finalize_players() writes explicitly when it rebuilds
# PlayerSeasons -- not just "whatever headers already happened to be
# there", so a damaged/incomplete sheet self-heals on the next run.
PLAYER_SEASONS_HEADERS = [
    "Player ID", "Season", "Team ID", "Division", "Position", "Height",
    "Class", "Games Played", "Games Started", "Finished",
]
PLAYER_SEASONS_NEW_COLUMNS = ["Team Name"]


def season_label(year):
    return f"{year - 1}-{str(year)[2:]}"


class Context:
    """Everything the scrape loop needs, loaded once per run."""

    def __init__(self, wb):
        self.wb = wb
        self.teams_ws = wb["Teams"]
        self.players_ws = wb["Players"]
        self.games_ws = wb["Games"]
        self.pgs_ws = wb["PlayerGameStats"]
        self.seasons_ws = wb["PlayerSeasons"]

        self.teams_hmap = header_map(self.teams_ws)
        self.players_hmap = ensure_columns(self.players_ws, PLAYER_NEW_COLUMNS)
        self.games_hmap = header_map(self.games_ws)
        self.pgs_hmap = ensure_columns(self.pgs_ws, PGS_NEW_COLUMNS)
        self.seasons_hmap = header_map(self.seasons_ws)

        self.team_rows = []           # [{row, team_id, name, division, conference, espn_id, status, done_seasons}]
        self.espn_to_team_id = {}
        self.team_id_to_conf = {}
        self.team_id_to_info = {}
        self._load_teams()

        self.espn_to_player_id = {}   # espn_athlete_id -> our Player ID
        self.next_player_id = 1
        self._load_players()

        self.games_seen = set()       # Game ID values already written
        self.next_row_players = self.players_ws.max_row + 1
        self.next_row_games = self.games_ws.max_row + 1
        self.next_row_pgs = self.pgs_ws.max_row + 1
        self._load_games_seen()

        # Filled in as we go, used only at the very end (see
        # finalize_players in this module) -- NOT written to the sheet
        # incrementally, so a transfer never gets "locked in" early.
        self.roster_info_by_espn_id = {}   # espn_athlete_id -> {height, class_year, team_id, division, roster_season}
        # NOTE: there used to be a self.season_agg dict accumulated here,
        # incrementally, by write_player_game_stat(). It was removed --
        # see the comment in write_player_game_stat() and
        # build_full_season_agg() below for why relying on an in-memory,
        # this-run-only accumulator to rebuild PlayerSeasons was the bug
        # that silently wiped most of the sheet on any partial run.

    def _load_teams(self):
        h = self.teams_hmap
        for row in range(2, self.teams_ws.max_row + 1):
            name = self.teams_ws.cell(row=row, column=h["Team"]).value
            if not name:
                continue
            team_id = self.teams_ws.cell(row=row, column=h["Team ID"]).value
            division = self.teams_ws.cell(row=row, column=h["Division"]).value
            conference = self.teams_ws.cell(row=row, column=h["Conference"]).value
            espn_id = self.teams_ws.cell(row=row, column=h["ESPN Team ID"]).value
            status = self.teams_ws.cell(row=row, column=h["Scrape Status"]).value
            last_seasons = self.teams_ws.cell(row=row, column=h["Last Scraped Season"]).value

            info = {
                "row": row, "team_id": team_id, "name": name, "division": division,
                "conference": conference, "espn_id": str(espn_id) if espn_id else None,
                "status": status, "done_seasons": set((last_seasons or "").split(",")) - {""},
            }
            self.team_rows.append(info)
            if info["espn_id"]:
                self.espn_to_team_id[info["espn_id"]] = team_id
            self.team_id_to_conf[team_id] = conference
            self.team_id_to_info[team_id] = info

    def _load_players(self):
        h = self.players_hmap
        max_id = 0
        for row in range(2, self.players_ws.max_row + 1):
            pid = self.players_ws.cell(row=row, column=h["Player ID"]).value
            ext_id = self.players_ws.cell(row=row, column=h["External ID"]).value
            if pid:
                max_id = max(max_id, pid)
            if ext_id:
                self.espn_to_player_id[str(ext_id)] = pid
        self.next_player_id = max_id + 1

    def _load_games_seen(self):
        h = self.games_hmap
        col = h["Game ID"]
        for row in range(2, self.games_ws.max_row + 1):
            gid = self.games_ws.cell(row=row, column=col).value
            if gid:
                self.games_seen.add(str(gid))

    def note_roster_entry(self, espn_athlete_id, height, class_year, team_id, division, roster_season):
        """Record what a team's CURRENT roster says about a player. Only
        one team's current roster should ever list a given athlete, so
        this naturally reflects wherever she is *now* -- last call wins,
        but in practice there's only ever one caller per athlete."""
        if not espn_athlete_id:
            return
        self.roster_info_by_espn_id[str(espn_athlete_id)] = {
            "height": height, "class_year": class_year, "team_id": team_id,
            "division": division, "roster_season": roster_season,
        }

    def resolve_player_id(self, espn_athlete_id, first_name, last_name, team_id,
                           position, division):
        """Get-or-create by ESPN athlete ID. Team ID/Height/Class here are
        just a starting point for a brand-new row -- finalize_players()
        overwrites them with the current-roster truth at the end of the
        run, so a transfer never leaves stale data behind."""
        key = str(espn_athlete_id)
        if key in self.espn_to_player_id:
            return self.espn_to_player_id[key]

        pid = self.next_player_id
        self.next_player_id += 1
        self.espn_to_player_id[key] = pid

        h = self.players_hmap
        row = self.next_row_players
        self.next_row_players += 1
        self.players_ws.cell(row=row, column=h["Player ID"], value=pid)
        self.players_ws.cell(row=row, column=h["First Name"], value=first_name)
        self.players_ws.cell(row=row, column=h["Last Name"], value=last_name)
        self.players_ws.cell(row=row, column=h["Team ID"], value=team_id)
        self.players_ws.cell(row=row, column=h["Position"], value=position)
        self.players_ws.cell(row=row, column=h["Finished"], value="Yes")
        self.players_ws.cell(row=row, column=h["External ID"], value=espn_athlete_id)
        self.players_ws.cell(row=row, column=h["Source"], value="ESPN")
        self.players_ws.cell(row=row, column=h["Division"], value=division)
        return pid

    def write_game_row(self, game_id, date, season, home_team_id, home_name,
                        away_team_id, away_name, home_score, away_score,
                        neutral_site):
        h = self.games_hmap
        row = self.next_row_games
        self.next_row_games += 1

        winner_id = None
        if home_score is not None and away_score is not None:
            winner_id = home_team_id if home_score > away_score else away_team_id
        margin = None
        if home_score is not None and away_score is not None:
            margin = home_score - away_score

        conf_game = None
        if home_team_id in self.team_id_to_conf and away_team_id in self.team_id_to_conf:
            conf_game = self.team_id_to_conf[home_team_id] == self.team_id_to_conf[away_team_id]

        values = {
            "Game ID": game_id, "Date": date, "Season": season,
            "Home Team ID": home_team_id, "Home Team": home_name,
            "Away Team ID": away_team_id, "Away Team": away_name,
            "conference Game": conf_game, "Conference Game": conf_game,
            "Neutral Site": neutral_site, "Home Score": home_score,
            "Away Score": away_score, "Winner": winner_id, "Margin": margin,
        }
        for key, val in values.items():
            col = h.get(key)
            if col:
                self.games_ws.cell(row=row, column=col, value=val)
        self.games_seen.add(str(game_id))

    def write_player_game_stat(self, player_id, team_id, division, opponent_name,
                                opponent_team_id, opponent_level, date, gs,
                                minutes, fgm, fga, fg3m, fg3a, ftm, fta,
                                rebound, foul, ast, to, blk, stl, points,
                                game_id, season, position):
        h = self.pgs_hmap
        row = self.next_row_pgs
        self.next_row_pgs += 1
        values = {
            "Player ID": player_id, "Team ID": team_id, "Opponent": opponent_name,
            "Opponent Team ID": opponent_team_id, "Opponent Level": opponent_level,
            "Date": date, "GS": gs, "Min": minutes, "FG Made": fgm, "FG Attempt": fga,
            "3FG M": fg3m, "3FG A": fg3a, "FT M": ftm, "FT A": fta, "Rebound": rebound,
            "Foul": foul, "Ast": ast, "To": to, "Blk": blk, "Stl": stl, "Points": points,
            "Game ID": game_id, "Season": season,
            # Written so finalize_players() can rebuild PlayerSeasons from
            # this sheet alone -- see PGS_NEW_COLUMNS note above. Rows
            # written before this column existed will just read back
            # blank here; the rebuild falls back to a current-roster/
            # current-Players-sheet lookup for those.
            "Position": position, "Division": division,
        }
        for key, val in values.items():
            col = h.get(key)
            if col:
                self.pgs_ws.cell(row=row, column=col, value=val)
        # NOTE: this used to also roll straight into an in-memory
        # self.season_agg dict here, and finalize_players() rebuilt
        # PlayerSeasons from that dict alone. That was the bug: season_agg
        # only ever contained rows written DURING THIS RUN, so any team
        # main() skipped as already "Done" contributed nothing, and a
        # partial/--only run would wipe PlayerSeasons down to just the
        # handful of teams it happened to touch. Fixed by dropping the
        # incremental accumulator entirely -- build_full_season_agg()
        # below now scans the COMPLETE, persisted PlayerGameStats sheet
        # (every row, every prior run, not just this one) at finalize
        # time instead. See finalize_players().

    def build_full_season_agg(self):
        """Scan the ENTIRE PlayerGameStats sheet (every row ever written,
        not just this run's) and return {(player_id, season): {team_id,
        division, position, games, starts}} -- the authoritative source
        finalize_players() rebuilds PlayerSeasons from. This is what makes
        a partial/--only run safe: a team we don't touch this run still
        has all its historical rows sitting in PlayerGameStats already,
        so it still shows up here.

        Division/Position were only added as PlayerGameStats columns in
        this fix (see PGS_NEW_COLUMNS) -- older rows written before that
        will read back blank for those two columns. For Division we fall
        back to the team's current Division from the Teams sheet (the
        same approximation the old code silently made anyway, since
        Teams has no historical-division tracking). For Position we fall
        back to that player's current Position from the Players sheet.
        Both fallbacks are applied by the caller, not here, since this
        method only knows about PlayerGameStats.
        """
        h = self.pgs_hmap
        col_pid = h["Player ID"]
        col_team = h["Team ID"]
        col_season = h["Season"]
        col_gs = h["GS"]
        col_pos = h.get("Position")
        col_div = h.get("Division")

        agg = {}
        for row in self.pgs_ws.iter_rows(min_row=2):
            pid = row[col_pid - 1].value
            season = row[col_season - 1].value
            if not pid or not season:
                continue
            team_id = row[col_team - 1].value
            gs = row[col_gs - 1].value
            position = row[col_pos - 1].value if col_pos else None
            division = row[col_div - 1].value if col_div else None

            key = (pid, season)
            entry = agg.setdefault(key, {
                "team_id": team_id, "division": division, "position": position,
                "games": 0, "starts": 0,
            })
            entry["team_id"] = team_id       # most recent game in the season wins
            if division:
                entry["division"] = division
            if position:
                entry["position"] = position
            entry["games"] += 1
            if gs == "Yes":
                entry["starts"] += 1
        return agg

    def mark_team_status(self, info, status, error=None, add_season=None):
        h = self.teams_hmap
        row = info["row"]
        if add_season:
            info["done_seasons"].add(str(add_season))
        self.teams_ws.cell(row=row, column=h["Scrape Status"], value=status)
        self.teams_ws.cell(
            row=row, column=h["Last Scraped Season"],
            value=",".join(sorted(info["done_seasons"])),
        )
        self.teams_ws.cell(row=row, column=h["Scrape Error"], value=error)
        self.teams_ws.cell(
            row=row, column=h["Last Updated"],
            value=datetime.datetime.now().isoformat(timespec="seconds"),
        )


def process_game(ctx, my_info, season, game):
    """Fetch and record one completed game (both teams' box scores)."""
    event_id = str(game["event_id"])
    if event_id in ctx.games_seen:
        return

    opponent_espn_id = str(game["opponent_espn_id"]) if game["opponent_espn_id"] else None
    opponent_team_id = ctx.espn_to_team_id.get(opponent_espn_id)
    opponent_level = None
    if opponent_team_id and opponent_team_id in ctx.team_id_to_info:
        opponent_level = ctx.team_id_to_info[opponent_team_id]["division"]

    home_away = game["home_away"]
    if home_away == "home":
        home_team_id, home_name = my_info["team_id"], my_info["name"]
        away_team_id, away_name = opponent_team_id, game["opponent_name"]
        home_score, away_score = game["team_score"], game["opponent_score"]
    else:
        home_team_id, home_name = opponent_team_id, game["opponent_name"]
        away_team_id, away_name = my_info["team_id"], my_info["name"]
        home_score, away_score = game["opponent_score"], game["team_score"]

    ctx.write_game_row(
        game_id=event_id, date=game["date"], season=season_label(season),
        home_team_id=home_team_id, home_name=home_name,
        away_team_id=away_team_id, away_name=away_name,
        home_score=home_score, away_score=away_score,
        neutral_site=game.get("neutral_site", False),
    )

    box = espn.get_boxscore(event_id)
    for espn_team_id, rows in box.items():
        team_id = ctx.espn_to_team_id.get(str(espn_team_id))
        if team_id == my_info["team_id"]:
            opp_team_id_for_row, opp_name_for_row, opp_level_for_row = (
                opponent_team_id, game["opponent_name"], opponent_level,
            )
            division_for_row = my_info["division"]
        elif team_id == opponent_team_id:
            opp_team_id_for_row, opp_name_for_row, opp_level_for_row = (
                my_info["team_id"], my_info["name"], my_info["division"],
            )
            division_for_row = opponent_level
        else:
            # Box score team we don't recognize at all -- skip rather than
            # guess. (Shouldn't normally happen since it's one of the two
            # teams from the schedule we just fetched.)
            continue
        if team_id is None:
            continue

        for player_row in rows:
            if not player_row.get("espn_athlete_id"):
                continue
            stats = player_row["raw_stats"]
            fgm, fga = espn.split_made_attempted(stats.get("FG"))
            fg3m, fg3a = espn.split_made_attempted(stats.get("3PT"))
            ftm, fta = espn.split_made_attempted(stats.get("FT"))

            player_id = ctx.resolve_player_id(
                espn_athlete_id=player_row["espn_athlete_id"],
                first_name=(player_row["name"] or "").split(" ")[0],
                last_name=" ".join((player_row["name"] or "").split(" ")[1:]),
                team_id=team_id, position=player_row["position"],
                division=division_for_row,
            )

            ctx.write_player_game_stat(
                player_id=player_id, team_id=team_id, division=division_for_row,
                opponent_name=opp_name_for_row, opponent_team_id=opp_team_id_for_row,
                opponent_level=opp_level_for_row, date=game["date"],
                gs="Yes" if player_row["starter"] else "No",
                minutes=espn.parse_minutes(stats.get("MIN")),
                fgm=fgm, fga=fga, fg3m=fg3m, fg3a=fg3a, ftm=ftm, fta=fta,
                rebound=espn.parse_int(stats.get("REB")),
                foul=espn.parse_int(stats.get("PF")), ast=espn.parse_int(stats.get("AST")),
                to=espn.parse_int(stats.get("TO")), blk=espn.parse_int(stats.get("BLK")),
                stl=espn.parse_int(stats.get("STL")), points=espn.parse_int(stats.get("PTS")),
                game_id=event_id, season=season_label(season),
                position=player_row["position"],
            )


def process_team(ctx, info, seasons):
    espn_id = info["espn_id"]
    if not espn_id:
        ctx.mark_team_status(info, "Needs ESPN ID")
        return

    current_season = max(seasons)
    try:
        roster = espn.get_roster(espn_id, season=current_season)
        for p in roster:
            ctx.note_roster_entry(
                espn_athlete_id=p.get("espn_athlete_id"), height=p.get("height"),
                class_year=p.get("class_year"), team_id=info["team_id"],
                division=info["division"], roster_season=season_label(current_season),
            )
    except espn.EspnError as exc:
        print(f"    [!] roster fetch failed for {info['name']}: {exc}")

    any_error = None
    for season in seasons:
        if str(season) in info["done_seasons"]:
            continue

        # Tracked separately from any_error (which persists across this
        # team's whole season loop just to decide the final "Done" vs
        # "Done with errors" status) -- season_error decides whether THIS
        # season specifically gets added to done_seasons. A transient
        # ESPN 500/504 on one game's box score shouldn't make the whole
        # season look finished: if it did, a later re-run would skip
        # this team+season entirely (done_seasons already has it) and
        # that one game's data would be permanently missing. Leaving the
        # season out of done_seasons instead means a re-run retries the
        # whole season's schedule cheaply -- every game already recorded
        # gets skipped via the Game ID dedup in games_seen, so only the
        # actually-missing game(s) get re-fetched.
        season_error = None
        try:
            schedule = espn.get_schedule(espn_id, season=season)
        except espn.EspnError as exc:
            season_error = str(exc)
            any_error = season_error
            print(f"    [!] schedule fetch failed for {info['name']} {season}: {exc}")
            continue

        for game in schedule:
            if not game["completed"]:
                continue
            try:
                process_game(ctx, info, season, game)
            except espn.EspnError as exc:
                season_error = str(exc)
                any_error = season_error
                print(f"    [!] box score failed for {info['name']} vs "
                      f"{game.get('opponent_name')} ({game['event_id']}): {exc}")

        if season_error:
            ctx.mark_team_status(info, "In Progress", error=season_error)
        else:
            ctx.mark_team_status(info, "In Progress", error=None, add_season=season)

    ctx.mark_team_status(
        info, "Done" if not any_error else "Done with errors", error=any_error,
    )


def finalize_players(ctx, current_season_label):
    """Run once, after every team has been processed.

    1. For every player, if we saw her on ANY team's current roster this
       run, that's authoritative: overwrite Team ID / Division / Height /
       Class with it. This is what makes a transfer show up correctly --
       whichever school's current roster lists her wins, not whichever
       school we happened to scrape first.
    2. For players not on any current roster (graduated / left the
       program before this season), fall back to her most recent season
       in PlayerGameStats for Team ID/Division. Height/Class stay blank
       for these players -- no current-roster source to pull them from.
       (There's a separate per-athlete ESPN endpoint,
       espn_client.get_athlete_height(), that CAN return Height for any
       athlete ID regardless of current-roster status -- intentionally
       not called from here, since it's a slow one-request-per-player
       pass better run as its own separate step. See run_d1_scrape.py's
       git history / conversation notes if reintroducing it.)
    3. Write the PlayerSeasons sheet from a fresh per-season aggregate
       built by scanning the COMPLETE, persisted PlayerGameStats sheet
       (every row ever written, across every past run -- not just the
       teams this run happened to reprocess). This is a deliberate fix
       for a bug that shipped earlier: PlayerSeasons used to be rebuilt
       from an in-memory dict that only accumulated rows written DURING
       THE CURRENT RUN, so any team main() skipped as already "Done"
       (i.e. almost every team, on any partial or --only run) contributed
       NOTHING, and the wipe-and-rebuild silently destroyed its
       PlayerSeasons history. Confirmed in practice: a run that only
       reprocessed ~10 straggler D1 teams collapsed PlayerSeasons from
       ~15,400 rows/361 teams down to 267 rows/19 teams. Building the
       aggregate from PlayerGameStats itself instead (see
       Context.build_full_season_agg()) makes the rebuild idempotent no
       matter how small a slice of teams a given run actually touches.
       The sheet is still rebuilt with its full header set written out
       explicitly (not just "whatever headers already happened to be
       there before the wipe") so a damaged/incomplete PlayerSeasons
       sheet self-heals instead of perpetuating the damage.
    4. Roll each player's season history into a single human-readable
       "Transfer History" string on the Players sheet (e.g. "Abilene
       Christian (2024-25) -> Air Force (2025-26)"), plus a "Schools
       Attended" count -- so a transfer shows up at a glance on the
       Players sheet itself, not just by cross-referencing PlayerSeasons.
       Because this also now sources from the complete PlayerGameStats
       history (see #3), it no longer has the old --only-run blind spot
       where a player's season at a team we didn't happen to reprocess
       this run would silently vanish from her timeline (confirmed
       against a real case previously: Player ID 27, Alancia Ramsey, was
       missing her entire 2024-25 Coastal Carolina season under the old
       logic -- that's fixed now since her 2024-25 games are already
       sitting in PlayerGameStats regardless of what this run touched).
    """
    ensure_columns(ctx.players_ws, PLAYER_NEW_COLUMNS)
    h = ctx.players_hmap = header_map(ctx.players_ws)
    found, not_found = 0, 0

    # The authoritative source for everything below: a fresh scan of the
    # ENTIRE PlayerGameStats sheet, not the this-run-only ctx.season_agg.
    # See build_full_season_agg()'s docstring and point #3 above.
    full_agg = ctx.build_full_season_agg()

    # Backfill Division/Position for legacy PlayerGameStats rows written
    # before those two columns existed (see PGS_NEW_COLUMNS) -- Division
    # falls back to the team's current Division (Teams has no historical
    # tracking anyway, so this matches what the old code silently assumed
    # too); Position falls back to that player's current Position on the
    # Players sheet.
    current_position_by_player = {}
    for row in range(2, ctx.players_ws.max_row + 1):
        pid = ctx.players_ws.cell(row=row, column=h["Player ID"]).value
        pos = ctx.players_ws.cell(row=row, column=h["Position"]).value
        if pid:
            current_position_by_player[pid] = pos

    for (player_id, season), agg in full_agg.items():
        if not agg.get("division"):
            info = ctx.team_id_to_info.get(agg["team_id"])
            agg["division"] = info["division"] if info else None
        if not agg.get("position"):
            agg["position"] = current_position_by_player.get(player_id)

    # Player ID -> most recent (season, team_id, division) from the games
    # we actually recorded, used as the fallback for #2 above.
    most_recent_by_player = {}
    for (player_id, season), agg in full_agg.items():
        prev = most_recent_by_player.get(player_id)
        if prev is None or season > prev[0]:
            most_recent_by_player[player_id] = (season, agg["team_id"], agg["division"])

    for row in range(2, ctx.players_ws.max_row + 1):
        pid = ctx.players_ws.cell(row=row, column=h["Player ID"]).value
        ext_id = ctx.players_ws.cell(row=row, column=h["External ID"]).value
        if not pid:
            continue

        roster_info = ctx.roster_info_by_espn_id.get(str(ext_id))
        if roster_info:
            found += 1
            ctx.players_ws.cell(row=row, column=h["Team ID"], value=roster_info["team_id"])
            ctx.players_ws.cell(row=row, column=h["Division"], value=roster_info["division"])
            ctx.players_ws.cell(row=row, column=h["Height"], value=roster_info["height"])
            ctx.players_ws.cell(row=row, column=h["Class"], value=roster_info["class_year"])
        else:
            not_found += 1
            fallback = most_recent_by_player.get(pid)
            if fallback:
                _, team_id, division = fallback
                ctx.players_ws.cell(row=row, column=h["Team ID"], value=team_id)
                ctx.players_ws.cell(row=row, column=h["Division"], value=division)
            # Height/Class intentionally left as-is (blank) -- not
            # available from ESPN for a player off every current roster.

    print(f"finalize_players: {found} players matched to a current roster "
          f"(Height/Class filled in), {not_found} not on any current roster "
          f"(Height/Class unavailable from ESPN for these).")

    # --- PlayerSeasons -------------------------------------------------
    # Height/Class come from ESPN's roster_info_by_espn_id lookup, which
    # only ever has entries for D1 players (D2 players are sourced from
    # Sidearm, not ESPN, and have no ESPN External ID to look up). This
    # sheet gets fully wiped and rebuilt every run (see full_agg docstring
    # above for why that's correct for Games Played/Started/Team/Division),
    # but height/class need to survive that wipe for players this script
    # has no way to refresh -- confirmed this was a real risk: running D1
    # after a D2 run would silently blank Height/Class for every D2
    # player, since roster_info lookup always misses for them. Read the
    # OLD sheet's Height/Class per (player_id, season) before wiping, and
    # fall back to it whenever there's no fresh ESPN roster_info -- covers
    # D2 players always, and also D1 players ESPN doesn't have current
    # roster data for (e.g. graduated/transferred out).
    old_extra = {}
    for _row_idx, values in iter_data_rows(ctx.seasons_ws, header_map(ctx.seasons_ws)):
        key = (values.get("Player ID"), values.get("Season"))
        old_extra[key] = (values.get("Height"), values.get("Class"))

    wipe_data_rows(ctx.wb, "PlayerSeasons", keep_header=False)
    ctx.seasons_ws = ctx.wb["PlayerSeasons"]
    for col, name in enumerate(PLAYER_SEASONS_HEADERS, start=1):
        ctx.seasons_ws.cell(row=1, column=col, value=name)
    sh = ensure_columns(ctx.seasons_ws, PLAYER_SEASONS_NEW_COLUMNS)

    # Build player_id -> external id once for the height/class lookups below.
    id_to_ext = {}
    for row in range(2, ctx.players_ws.max_row + 1):
        pid = ctx.players_ws.cell(row=row, column=h["Player ID"]).value
        ext = ctx.players_ws.cell(row=row, column=h["External ID"]).value
        if pid:
            id_to_ext[pid] = ext

    def team_name(team_id):
        info = ctx.team_id_to_info.get(team_id)
        return info["name"] if info else None

    for (player_id, season), agg in sorted(full_agg.items()):
        roster_info = ctx.roster_info_by_espn_id.get(str(id_to_ext.get(player_id)))
        old_height, old_class = old_extra.get((player_id, season), (None, None))
        if roster_info:
            height = roster_info["height"]
            class_year = roster_info["class_year"] if season == current_season_label else None
            # ESPN had nothing for one of these two specifically (rare,
            # but seen) -- still don't let a fresh-but-partial lookup
            # blank a value we already had.
            height = height or old_height
            class_year = class_year or (old_class if season == current_season_label else None)
        else:
            height = old_height
            class_year = old_class if season == current_season_label else None

        row_values = {
            "Player ID": player_id, "Season": season, "Team ID": agg["team_id"],
            "Team Name": team_name(agg["team_id"]), "Division": agg["division"],
            "Position": agg["position"], "Height": height, "Class": class_year,
            "Games Played": agg["games"], "Games Started": agg["starts"],
            "Finished": "Yes",
        }
        r = ctx.seasons_ws.max_row + 1
        for key, val in row_values.items():
            col = sh.get(key)
            if col:
                ctx.seasons_ws.cell(row=r, column=col, value=val)

    print(f"PlayerSeasons: wrote {len(full_agg)} player-season rows "
          f"(Height/Class preserved from prior data where ESPN had nothing fresh).")

    # --- Transfer History rollup on Players -----------------------------
    # One line per player: her schools in chronological order, so a
    # transfer is visible on the Players sheet itself without having to
    # cross-reference PlayerSeasons.
    seasons_by_player = {}
    for (player_id, season), agg in full_agg.items():
        seasons_by_player.setdefault(player_id, []).append((season, agg["team_id"]))

    transfer_count = 0
    for row in range(2, ctx.players_ws.max_row + 1):
        pid = ctx.players_ws.cell(row=row, column=h["Player ID"]).value
        if not pid:
            continue
        timeline = sorted(set(seasons_by_player.get(pid, [])))
        # Group consecutive seasons at the same school into one stint,
        # e.g. two years at School A then one at School B becomes
        # "School A (2023-24 -- 2024-25) -> School B (2025-26)" rather
        # than repeating School A on its own line for each season.
        stints = []
        for season, team_id in timeline:
            school = team_name(team_id) or f"Team {team_id}"
            if stints and stints[-1]["school"] == school:
                stints[-1]["end"] = season
            else:
                stints.append({"school": school, "start": season, "end": season})

        parts = []
        for stint in stints:
            if stint["start"] == stint["end"]:
                parts.append(f"{stint['school']} ({stint['start']})")
            else:
                parts.append(f"{stint['school']} ({stint['start']} -- {stint['end']})")
        history_str = " -> ".join(parts)

        distinct_schools = len({s["school"] for s in stints})
        if distinct_schools > 1:
            transfer_count += 1

        ctx.players_ws.cell(row=row, column=h["Transfer History"], value=history_str or None)
        ctx.players_ws.cell(row=row, column=h["Schools Attended"], value=distinct_schools or None)

    print(f"Transfer History: {transfer_count} players show more than one school "
          f"within the scraped seasons.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--seasons", nargs="+", type=int, default=DEFAULT_SEASONS)
    parser.add_argument("--only", help="Comma-separated team names, for testing on a few schools first")
    args = parser.parse_args()

    print(f"run_d1_scrape.py -- last revised {LAST_REVISED}")
    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)
    ctx = Context(wb)

    targets = ctx.team_rows
    if args.only:
        wanted = {n.strip().lower() for n in args.only.split(",")}
        targets = [t for t in targets if t["name"].lower() in wanted]
    else:
        targets = [t for t in targets if t["division"] == "D1"]

    print(f"{len(targets)} D1 teams to process, seasons {args.seasons}.")

    for i, info in enumerate(targets, start=1):
        if set(str(s) for s in args.seasons) <= info["done_seasons"] and info["status"] == "Done":
            continue
        print(f"[{i}/{len(targets)}] {info['name']} (ESPN ID {info['espn_id']}) ...")
        try:
            process_team(ctx, info, args.seasons)
        except Exception as exc:  # noqa: BLE001 -- keep the run alive across one bad team
            print(f"    [!] unexpected error on {info['name']}: {exc}")
            ctx.mark_team_status(info, "Failed", error=str(exc))

        if i % CHECKPOINT_EVERY == 0:
            print("  -- saving checkpoint --")
            save_with_retry(ctx.wb, args.path)

        time.sleep(SLEEP_BETWEEN_TEAMS)

    print("Finalizing player identities and season history ...")
    finalize_players(ctx, season_label(max(args.seasons)))

    print("Final save ...")
    save_with_retry(ctx.wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
