"""Quick sanity check for espn_client_mbb.py -- run this FIRST, before
the full men's D1 scrape, so a schema change on ESPN's end shows up in
10 seconds instead of after hours of scraping.

Mirrors scrapers/smoke_test_espn.py (the women's version) exactly,
just pointed at scrapers.espn_client_mbb and a men's team.

Usage:
    python scrapers/smoke_test_espn_mbb.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers.espn_client_mbb as espn

# Duke -- picked because it's a real, active D1 men's program that will
# always have a current roster and a recently-completed game, unlike a
# hardcoded ID that could go stale. Resolved by name from list_teams()
# below rather than hardcoded, so this stays correct even if ESPN ever
# renumbers a team ID.
TARGET_TEAM_NAME = "Duke"


def main():
    print("1) list_teams() -- fetching the full D1 team list ...")
    teams = espn.list_teams()
    print(f"   got {len(teams)} teams. First 3: {teams[:3]}")
    assert len(teams) > 300, "Expected 300+ D1 men's teams -- got far fewer, check the response shape."

    target = next((t for t in teams if t.get("location") == TARGET_TEAM_NAME), teams[0])
    target_id = target["espn_id"]
    print(f"   using {target.get('name')} (ESPN ID {target_id}) as the smoke-test team.")

    print(f"\n2) get_roster() -- {target.get('name')} current roster ...")
    roster = espn.get_roster(target_id)
    print(f"   got {len(roster)} players. First 2: {roster[:2]}")
    assert len(roster) >= 8, "Expected at least 8 roster players."

    print(f"\n3) get_schedule() -- {target.get('name')} 2025-26 schedule ...")
    schedule = espn.get_schedule(target_id, season=2026)
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

    print("\nAll checks passed -- espn_client_mbb.py matches ESPN's current response shapes.")


if __name__ == "__main__":
    main()
