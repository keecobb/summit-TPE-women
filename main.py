"""Summit TPE prototype -- end-to-end demo run.

Builds a fresh SQLite database, seeds it with synthetic D1/D2 teams,
players, games and box scores, computes team strength ratings from the
competition network, runs every player through the PDI engine, prints
a leaderboard, then runs the transfer-translation projector for one
D2 player against several candidate D1 destinations.

Run with:  python main.py
No external dependencies required (stdlib only).
"""

from pathlib import Path

from summit_tpe import db
from summit_tpe.pdi import evaluate_player_season, scale_to_pdi
from summit_tpe.ratings import compute_team_ratings
from summit_tpe.seed_data import PLAYERS, TEAMS, seed
from summit_tpe.transfer import project_transfer

DB_PATH = Path(__file__).parent / "summit_tpe_demo.db"


def load_games(conn):
    cur = conn.execute(
        "SELECT game_id, home_team_id, away_team_id, home_score, away_score FROM game"
    )
    return [dict(row) for row in cur.fetchall()]


def load_player_games(conn, player_id):
    cur = conn.execute("SELECT * FROM player_game_stat WHERE player_id = ?", (player_id,))
    return [dict(row) for row in cur.fetchall()]


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = db.connect(DB_PATH)
    db.init_db(conn)
    seed(conn)

    team_lookup = {t[0]: t for t in TEAMS}
    team_ids = list(team_lookup.keys())
    games = load_games(conn)
    team_ratings = compute_team_ratings(team_ids, games)

    print("=" * 78)
    print("SUMMIT TPE -- prototype run (100% synthetic demo data, not real games)")
    print("=" * 78)

    print("\nTeam strength ratings (Elo-style, converged across the D1/D2 crossover network)\n")
    ranked_teams = sorted(team_ratings.items(), key=lambda kv: kv[1], reverse=True)
    for rank, (team_id, rating) in enumerate(ranked_teams, start=1):
        name = team_lookup[team_id][1]
        division = team_lookup[team_id][2]
        print(f"  {rank:2d}. {name:<26} ({division})  rating={rating:7.1f}")

    season_summaries = {}
    for player_id, name, team_id, position, class_year, height_in, base_minutes, profile in PLAYERS:
        rows = load_player_games(conn, player_id)
        season_summaries[player_id] = evaluate_player_season(position, class_year, rows, team_ratings)

    pdi_by_player = scale_to_pdi({pid: s["season_raw"] for pid, s in season_summaries.items()})

    print("\nProjection Data Index (PDI) leaderboard\n")
    header = (
        f"  {'Rank':<5}{'Player':<18}{'Team':<26}{'Div':<5}"
        f"{'PDI':<7}{'P/40':<7}{'R/40':<7}{'A/40':<7}{'MPG':<6}"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))

    player_lookup = {p[0]: p for p in PLAYERS}
    ranked_players = sorted(pdi_by_player.items(), key=lambda kv: kv[1], reverse=True)
    for rank, (player_id, pdi_val) in enumerate(ranked_players, start=1):
        p = player_lookup[player_id]
        s = season_summaries[player_id]
        team_name = team_lookup[p[2]][1]
        division = team_lookup[p[2]][2]
        print(
            f"  {rank:<5}{p[1]:<18}{team_name:<26}{division:<5}{pdi_val:<7}"
            f"{s['per40_pts']:<7.1f}{s['per40_reb']:<7.1f}{s['per40_ast']:<7.1f}{s['avg_minutes']:<6.1f}"
        )

    # Flagship feature demo: project a D2 player's stats at several D1 schools.
    focal_id = "P03"  # Guard C, Crestview State (D2)
    focal = player_lookup[focal_id]
    current_team = team_lookup[focal[2]]
    destinations = ["DRKE", "NAU", "CSU", "UIC", "UVU"]

    print(f"\nTransfer translation demo: {focal[1]} ({current_team[1]}, D2) -> candidate D1 destinations\n")
    header2 = (
        f"  {'Destination':<20}{'Proj MPG':<10}{'Proj PPG':<10}"
        f"{'Proj RPG':<10}{'Proj APG':<10}{'Proj PDI':<10}{'Start %':<8}"
    )
    print(header2)
    print("  " + "-" * (len(header2) - 2))

    for dest_id in destinations:
        dest_tuple = team_lookup[dest_id]
        dest_team = dict(name=dest_tuple[1], tempo=dest_tuple[4], rating=team_ratings[dest_id])
        current_team_dict = dict(
            name=current_team[1], tempo=current_team[4], rating=team_ratings[focal[2]]
        )
        result = project_transfer(
            season_summaries[focal_id], pdi_by_player[focal_id], current_team_dict, dest_team
        )
        print(
            f"  {result['destination']:<20}{result['projected_minutes']:<10}"
            f"{result['projected_ppg']:<10}{result['projected_rpg']:<10}"
            f"{result['projected_apg']:<10}{result['projected_pdi']:<10}"
            f"{result['starter_probability']:<8}"
        )

    conn.close()
    print(f"\nSQLite demo database written to: {DB_PATH}")
    print("Synthetic prototype -- see README.md for what's real vs. simplified.")


if __name__ == "__main__":
    main()
