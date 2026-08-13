"""Quick sanity check for espn_client.py -- run this FIRST, before the
full D1 scrape, so a schema change on ESPN's end shows up in 10 seconds
instead of after hours of scraping.

Usage:
    python scrapers/smoke_test_espn.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers.espn_client as espn

SOUTH_CAROLINA_ESPN_ID = "2579"


def main():
    print("1) list_teams() -- fetching the full D1 team list ...")
    teams = espn.list_teams()
    print(f"   got {len(teams)} teams. First 3: {teams[:3]}")
    assert len(teams) > 300, "Expected 300+ D1 women's teams -- got far fewer, check the response shape."

    print("\n2) get_roster() -- South Carolina current roster ...")
    roster = espn.get_roster(SOUTH_CAROLINA_ESPN_ID)
    print(f"   got {len(roster)} players. First 2: {roster[:2]}")
    assert len(roster) >= 8, "Expected at least 8 roster players."

    print("\n3) get_schedule() -- South Carolina 2025-26 schedule ...")
    schedule = espn.get_schedule(SOUTH_CAROLINA_ESPN_ID, season=2026)
    print(f"   got {len(schedule)} games. First game: {schedule[0]}")
    completed = [g for g in schedule if g["completed"]]
    print(f"   {len(completed)} completed games with scores.")
    assert completed, "Expected at least one completed game with a final score."

    print("\n4) get_boxscore() -- box score for the first completed game ...")
    event_id = completed[0]["event_id"]
    box = espn.get_boxscore(event_id)
    print(f"   event {event_id}: box score has {len(box)} teams.")
    for team_id, rows in box.items():
        print(f"   team {team_id}: {len(rows)} players, e.g. {rows[0] if rows else 'none'}")
    assert len(box) == 2, "Expected box score data for exactly 2 teams."

    print("\nAll checks passed -- espn_client.py matches ESPN's current response shapes.")


if __name__ == "__main__":
    main()
