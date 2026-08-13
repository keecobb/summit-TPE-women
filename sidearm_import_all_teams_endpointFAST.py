import re
import time
import pandas as pd
import xlwings as xw
from datetime import datetime
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

EXCEL_FILE = "HoopSourceStats.xlsx"

TEAMS_SHEET = "Teams"
PLAYERS_SHEET = "Players"
GAME_STATS_SHEET = "PlayerGameStats"

SPORT_CODES = ["mbball", "mbb", "m-basketball", "mens-basketball", "mbasketball", "mbasket", "mensbasketball"]
YEAR_OFFSETS = [0]


def get_year_from_url(url):
    match = re.search(r"/stats/(\d{4})", str(url))
    return match.group(1) if match else "2025"


def get_base_url(url):
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def clean_height(height):
    if pd.isna(height):
        return ""
    return str(height).strip().replace("-", ".")


def clean_int(value):
    try:
        if pd.isna(value):
            return ""
        return int(float(value))
    except:
        return value


def clean_opponent(value):
    if value is None:
        return ""

    text = str(value).strip()

    if "<" in text and ">" in text:
        return BeautifulSoup(text, "html.parser").get_text(strip=True)

    return text.strip()


def split_name(full_name):
    name = str(full_name).strip()

    if "," in name:
        last, first = name.split(",", 1)
        return first.strip(), last.strip()

    parts = name.replace(",", "").split()

    if len(parts) == 1:
        return parts[0], ""

    return parts[0], " ".join(parts[1:])


def extract_rp_id(player):
    text = str(player)

    patterns = [
        r"rp_id=(\d+)",
        r"data-rp-id=['\"](\d+)['\"]",
        r"data-player-id=['\"](\d+)['\"]",
        r"data-roster-player-id=['\"](\d+)['\"]",
        r"RosterPlayerId['\"]?\s*[:=]\s*['\"]?(\d+)"
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)

    return ""


def parse_bio_info(data):
    if not data:
        return "", "", ""

    bio = data.get("bio", {}) or {}

    position = bio.get("position", "")
    height = bio.get("height", "")
    player_class = bio.get("academic_class", "")

    return position, height, player_class


def load_existing_players(players_sheet):
    existing_players = {}

    # Use column A values and find the last actual numeric Player ID
    col_a = players_sheet.range("A2:A200000").value

    last_row = 1
    max_player_id = 0

    for i, value in enumerate(col_a, start=2):
        if value is None or str(value).strip() == "":
            continue

        try:
            player_id_num = int(float(value))
            max_player_id = max(max_player_id, player_id_num)
            last_row = i
        except:
            continue

    if last_row < 2:
        return existing_players, 1, 2

    rows = players_sheet.range(f"A2:H{last_row}").value

    if rows is None:
        return existing_players, 1, 2

    if rows and not isinstance(rows[0], list):
        rows = [rows]

    for idx, row in enumerate(rows, start=2):
        if not row or row[0] is None:
            continue

        player_id = row[0]
        first_name = row[1]
        last_name = row[2]
        team_id = row[3]

        key = (
            str(first_name).strip().lower(),
            str(last_name).strip().lower(),
            str(team_id).strip()
        )

        existing_players[key] = {
            "player_id": player_id,
            "row": idx
        }

    next_player_id = max_player_id + 1 if max_player_id else 1
    next_player_row = last_row + 1

    return existing_players, next_player_id, next_player_row

def add_or_update_player_fast(
    players_sheet,
    existing_players,
    team_id,
    player_name,
    position,
    height,
    player_class,
    next_player_id,
    next_player_row
):
    first_name, last_name = split_name(player_name)

    key = (
        first_name.strip().lower(),
        last_name.strip().lower(),
        str(team_id).strip()
    )

    if key in existing_players:
        player_id = existing_players[key]["player_id"]
        player_row = existing_players[key]["row"]

        print(f"Existing player: {player_name} | Player ID {player_id}")

    else:
        player_id = next_player_id
        player_row = next_player_row

        players_sheet.range(f"A{player_row}:H{player_row}").value = [[
            player_id,
            first_name,
            last_name,
            team_id,
            position,
            clean_height(height),
            player_class,
            "Yes"
        ]]

        existing_players[key] = {
            "player_id": player_id,
            "row": player_row
        }

        next_player_id += 1
        next_player_row += 1

        print(f"Added player: {player_name} | Player ID {player_id}")

        return player_id, next_player_id, next_player_row

    players_sheet.range(f"E{player_row}:H{player_row}").value = [[
        position,
        clean_height(height),
        player_class,
        "Yes"
    ]]

    return player_id, next_player_id, next_player_row


def build_game_log_rows(player_id, team_id, player_name, data):
    if not data:
        print(f"No data for {player_name}.")
        return []

    stats = data.get("stats", {}) or {}
    rows = stats.get("game_by_game_stats", []) or []

    output_rows = []

    for row in rows:
        if row.get("is_a_footer_stat") is True:
            continue

        if not row.get("date"):
            continue

        output_rows.append([
            player_id,
            team_id,
            "",
            clean_opponent(row.get("opponent", "")),
            "",
            "",
            "",
            row.get("date", ""),
            "Yes" if str(row.get("game_started", "")).strip() == "1" else "",
            clean_int(row.get("minutes_played", "")),
            clean_int(row.get("field_goals_made", "")),
            clean_int(row.get("field_goals_attempted", "")),
            clean_int(row.get("three_points_field_goals_made", "")),
            clean_int(row.get("three_points_field_goals_attempted", "")),
            clean_int(row.get("free_throws", "")),
            clean_int(row.get("free_throws_attempted", "")),
            clean_int(row.get("total_rebounds", "")),
            clean_int(row.get("personal_fouls", "")),
            clean_int(row.get("assists", "")),
            clean_int(row.get("turnovers", "")),
            clean_int(row.get("blocks", "")),
            clean_int(row.get("steals", "")),
            clean_int(row.get("points", ""))
        ])

    if not output_rows:
        print(f"No real game rows for {player_name}.")

    return output_rows


def get_sidearm_players(page):
    page.locator("a[href='#individual']").click()
    page.wait_for_timeout(1000)

    rows = page.locator("#individual table").first.locator("tbody tr").evaluate_all("""
        rows => rows.map(row => {
            const link = row.querySelector("td:nth-child(2) a");
            if (!link) return null;

            return {
                name: link.innerText.trim(),
                outerHTML: link.outerHTML,
                href: link.href,
                dataset: {...link.dataset}
            };
        }).filter(x => x && x.name)
    """)

    players = []

    for row in rows:
        rp_id = extract_rp_id(row)

        if rp_id:
            players.append({
                "name": row["name"],
                "rp_id": rp_id
            })
        else:
            print(f"No rp_id found for {row['name']}")

    return players


def import_sidearm_team(
    team_id,
    stats_url,
    players_sheet,
    game_stats_sheet,
    page,
    existing_players,
    next_player_id,
    next_player_row
):
    base_url = get_base_url(stats_url)
    year = get_year_from_url(stats_url)

    page.goto(stats_url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)

    players = get_sidearm_players(page)

    print(f"Found {len(players)} Sidearm players with rp_id.")

    total_players = 0
    total_games = 0
    all_game_rows = []

    for player in players:
        player_name = player["name"]
        rp_id = player["rp_id"]

        data = None
        base_year = int(year)

        for year_offset in YEAR_OFFSETS:
            test_year = str(base_year + year_offset)

            for sport_code in SPORT_CODES:
                endpoint = f"{base_url}/services/roster_bio_stats.ashx?rp_id={rp_id}&sport={sport_code}&year={test_year}"

                print(f"\nTrying {player_name}: {endpoint}")

                response = None

                for attempt in range(1, 4):
                    try:
                        response = page.request.get(endpoint, timeout=60000)
                        break
                    except Exception as e:
                        print(f"Attempt {attempt}/3 failed for {player_name}: {e}")
                        if attempt < 3:
                            time.sleep(3)

                if response is None or not response.ok:
                    continue

                try:
                    test_data = response.json()
                except Exception:
                    continue

                if not isinstance(test_data, dict):
                    continue

                stats = test_data.get("stats") or {}
                if not isinstance(stats, dict):
                    continue

                rows = stats.get("game_by_game_stats") or []
                rows = [
                    r for r in rows
                    if isinstance(r, dict) and not r.get("is_a_footer_stat", False)
                ]

                if rows:
                    print(f"SUCCESS using sport code '{sport_code}' and year '{test_year}'")
                    data = test_data
                    break

            if data is not None:
                break

        if data is None:
            print(f"No game log found for {player_name}")
            continue

        position, height, player_class = parse_bio_info(data)

        player_id, next_player_id, next_player_row = add_or_update_player_fast(
            players_sheet=players_sheet,
            existing_players=existing_players,
            team_id=team_id,
            player_name=player_name,
            position=position,
            height=height,
            player_class=player_class,
            next_player_id=next_player_id,
            next_player_row=next_player_row
        )

        game_rows = build_game_log_rows(
            player_id=player_id,
            team_id=team_id,
            player_name=player_name,
            data=data
        )

        all_game_rows.extend(game_rows)

        print(f"Prepared {len(game_rows)} games for {player_name}")

        total_players += 1
        total_games += len(game_rows)

    if all_game_rows:
        last_game_row = game_stats_sheet.range("A" + str(game_stats_sheet.cells.last_cell.row)).end("up").row
        next_game_row = last_game_row + 1

        game_stats_sheet.range(f"A{next_game_row}").value = all_game_rows

        print(f"Wrote {len(all_game_rows)} total game rows to Excel.")

    return total_players, total_games, next_player_id, next_player_row


def main():
    start_time = time.time()

    wb = xw.Book(EXCEL_FILE)

    teams_sheet = wb.sheets[TEAMS_SHEET]
    players_sheet = wb.sheets[PLAYERS_SHEET]
    game_stats_sheet = wb.sheets[GAME_STATS_SHEET]

    print("Loading existing players into memory...")
    existing_players, next_player_id, next_player_row = load_existing_players(players_sheet)
    print(f"Loaded {len(existing_players)} existing players.")
    print(f"Next Player ID: {next_player_id}")
    print(f"Next Player Row: {next_player_row}")

    last_team_row = teams_sheet.range("A" + str(teams_sheet.cells.last_cell.row)).end("up").row

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        for row in range(2, last_team_row + 1):
            team_id = teams_sheet.range(f"A{row}").value
            stats_url = teams_sheet.range(f"I{row}").value
            imported = teams_sheet.range(f"J{row}").value
            site_type = teams_sheet.range(f"N{row}").value

            if str(site_type).strip().lower() != "sidearm":
                continue

            if not stats_url:
                continue

            if str(imported).strip().lower() == "yes":
                continue

            print("\n==============================")
            print(f"Importing Sidearm Team Row {row}")
            print(f"Team ID: {team_id}")
            print(f"Stats URL: {stats_url}")

            team_start = time.time()

            try:
                players_added, games_added, next_player_id, next_player_row = import_sidearm_team(
                    team_id=team_id,
                    stats_url=stats_url,
                    players_sheet=players_sheet,
                    game_stats_sheet=game_stats_sheet,
                    page=page,
                    existing_players=existing_players,
                    next_player_id=next_player_id,
                    next_player_row=next_player_row
                )

                if games_added == 0:
                    teams_sheet.range(f"J{row}").value = "0 Games"
                elif players_added == 0:
                    teams_sheet.range(f"J{row}").value = "0 Players"
                else:
                    teams_sheet.range(f"J{row}").value = "Yes"

                teams_sheet.range(f"K{row}").value = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                teams_sheet.range(f"L{row}").value = ""

                elapsed = round(time.time() - team_start, 2)

                print(f"Completed Team ID {team_id}: {players_added} players, {games_added} games.")
                print(f"Team import time: {elapsed} seconds")

            except Exception as e:
                error_message = str(e)
                teams_sheet.range(f"L{row}").value = error_message
                print(f"ERROR importing Team ID {team_id}: {error_message}")

            wb.save()
            time.sleep(0.5)

        try:
            browser.close()
        except:
            pass

    wb.save()

    total_elapsed = round((time.time() - start_time) / 60, 2)
    print(f"DONE IMPORTING SIDEARM TEAMS in {total_elapsed} minutes")


if __name__ == "__main__":
    main()