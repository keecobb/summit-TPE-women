"""Synthetic demo data for the Summit TPE prototype.

IMPORTANT: none of this is real. Team names for real D1 programs are
used only as recognizable stand-ins (the same schools the product
brief itself references, e.g. as example transfer destinations); the
D2 programs are entirely fictional so nothing here reads as a claim
about a real school's actual results. All scores and box stats are
procedurally simulated from a fixed random seed so results are
reproducible run to run.

The schedule is built so the D1 pool round-robins internally, the D2
pool round-robins internally, and eight crossover games connect the
two pools -- this is what lets ratings.py's competition network place
D2 teams on the same scale as D1 teams.
"""

import random
from datetime import date, timedelta

from .utils import clamp

SEASON = "2025-26"

# team_id, name, division, conference, tempo (poss/40), true strength
# (strength is a hidden simulation input, not stored in the DB -- the
# whole point of ratings.py is to *recover* something like it from
# game results only).
TEAMS = [
    ("SC",   "South Carolina",        "D1", "SEC",            68.0, 2050),
    ("CONN", "UConn",                 "D1", "Big East",       66.0, 2020),
    ("TENN", "Tennessee",             "D1", "SEC",            72.0, 1900),
    ("LSU",  "LSU",                   "D1", "SEC",            74.0, 1850),
    ("MTSU", "Middle Tennessee",      "D1", "Conference USA", 70.0, 1650),
    ("CSU",  "Colorado State",        "D1", "Mountain West",  69.0, 1600),
    ("DRKE", "Drake",                 "D1", "Missouri Valley",67.0, 1580),
    ("UVU",  "Utah Valley",           "D1", "WAC",            71.0, 1520),
    ("NAU",  "Northern Arizona",      "D1", "Big Sky",        70.0, 1500),
    ("UIC",  "UIC",                   "D1", "Missouri Valley",68.0, 1480),
    ("CRSV", "Crestview State",       "D2", "GLVC",           70.0, 1560),
    ("ASHF", "Ashford College",       "D2", "GLVC",           69.0, 1420),
    ("RVRT", "Rivertown A&M",         "D2", "SAC",            68.0, 1370),
    ("BRDG", "Blue Ridge University", "D2", "SAC",            71.0, 1310),
]

D1_IDS = [t[0] for t in TEAMS if t[2] == "D1"]
D2_IDS = [t[0] for t in TEAMS if t[2] == "D2"]

# D2 <-> D1 crossover games -- these are the edges that connect the
# two divisions into one competition network.
CROSSOVER_PAIRS = [
    ("CRSV", "MTSU"), ("CRSV", "UVU"),
    ("ASHF", "NAU"),  ("ASHF", "UIC"),
    ("RVRT", "DRKE"), ("RVRT", "CSU"),
    ("BRDG", "UIC"),  ("BRDG", "NAU"),
]

# player_id, name, team_id, position, class_year, height_in,
# base_minutes (role baseline), per-40 talent profile.
PLAYERS = [
    ("P01", "Guard A", "SC", "PG", "JR", 69, 32, dict(
        fga=13, fg_pct=0.48, fg3a=4.0, fg3_pct=0.38, fta=4.0, ft_pct=0.85,
        oreb=0.5, dreb=3.0, ast=5.5, stl=2.0, blk=0.2, tov=2.3, pf=2.0)),
    ("P02", "Guard B", "CSU", "SG", "SR", 70, 31, dict(
        fga=15, fg_pct=0.45, fg3a=5.0, fg3_pct=0.35, fta=5.0, ft_pct=0.82,
        oreb=0.6, dreb=3.4, ast=3.0, stl=1.5, blk=0.1, tov=2.5, pf=2.2)),
    ("P03", "Guard C", "CRSV", "PG", "SR", 68, 33, dict(
        fga=12, fg_pct=0.49, fg3a=3.5, fg3_pct=0.40, fta=4.5, ft_pct=0.88,
        oreb=0.6, dreb=3.9, ast=6.0, stl=2.3, blk=0.2, tov=2.0, pf=1.8)),
    ("P04", "Sixth Player D", "CONN", "WING", "SO", 71, 16, dict(
        fga=11, fg_pct=0.47, fg3a=3.0, fg3_pct=0.37, fta=3.5, ft_pct=0.80,
        oreb=1.2, dreb=3.8, ast=2.5, stl=1.8, blk=0.6, tov=1.8, pf=2.3)),
    ("P05", "Star E", "LSU", "CENTER", "GR", 76, 30, dict(
        fga=13, fg_pct=0.58, fg3a=0.2, fg3_pct=0.20, fta=6.0, ft_pct=0.68,
        oreb=3.5, dreb=9.0, ast=1.5, stl=0.7, blk=3.0, tov=2.4, pf=3.0)),
    ("P06", "Volume Scorer F", "BRDG", "SG", "SR", 70, 33, dict(
        fga=20, fg_pct=0.40, fg3a=7.0, fg3_pct=0.31, fta=5.0, ft_pct=0.75,
        oreb=0.5, dreb=2.5, ast=2.0, stl=1.2, blk=0.1, tov=3.2, pf=2.5)),
    ("P07", "Freshman G", "NAU", "FORWARD", "FR", 73, 22, dict(
        fga=9, fg_pct=0.52, fg3a=1.0, fg3_pct=0.30, fta=3.0, ft_pct=0.78,
        oreb=2.5, dreb=5.0, ast=1.2, stl=1.0, blk=0.8, tov=1.6, pf=2.8)),
    ("P08", "Point H", "MTSU", "PG", "JR", 68, 29, dict(
        fga=11, fg_pct=0.44, fg3a=3.5, fg3_pct=0.33, fta=3.0, ft_pct=0.80,
        oreb=0.5, dreb=3.3, ast=5.0, stl=1.6, blk=0.1, tov=2.1, pf=2.0)),
    ("P09", "Bench I", "ASHF", "CENTER", "SO", 75, 14, dict(
        fga=8, fg_pct=0.46, fg3a=0.0, fg3_pct=0.0, fta=3.0, ft_pct=0.60,
        oreb=2.8, dreb=5.2, ast=0.5, stl=0.4, blk=1.0, tov=2.0, pf=3.2)),
]


def _round_robin_pairs(ids):
    pairs = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            pairs.append((ids[i], ids[j]))
    return pairs


def build_schedule():
    """All game pairings: D1 round robin + D2 round robin + crossovers."""
    return _round_robin_pairs(D1_IDS) + _round_robin_pairs(D2_IDS) + CROSSOVER_PAIRS


def simulate_score(strength_home, strength_away, tempo_home, tempo_away, rng):
    """Turn two hidden 'true strength' values into a plausible final score."""
    avg_tempo = (tempo_home + tempo_away) / 2.0
    strength_diff = (strength_home - strength_away) / 100.0
    home_adv = 2.5

    margin = strength_diff * 1.7 + home_adv + rng.gauss(0, 8.5)
    base_total = avg_tempo * 1.95 + rng.gauss(0, 5)

    home_score = round((base_total + margin) / 2.0)
    away_score = round((base_total - margin) / 2.0)

    return max(35, home_score), max(35, away_score)


def minutes_for_game(base_minutes, margin_abs, rng):
    """Blowouts trim a player's minutes (garbage time); close games don't."""
    if margin_abs >= 20:
        factor = rng.uniform(0.55, 0.75)
    elif margin_abs >= 12:
        factor = rng.uniform(0.78, 0.92)
    else:
        factor = rng.uniform(0.95, 1.12)
    return round(clamp(base_minutes * factor, 3.0, 38.0), 1)


def stat_line_from_per40(profile, minutes, rng):
    """Generate an internally-consistent box score line for one game."""
    scale = minutes / 40.0

    def noisy(mean, rel_noise=0.22):
        m = mean * scale
        if m <= 0:
            return 0.0
        return max(0.0, rng.gauss(m, max(0.25, m * rel_noise)))

    fga = round(noisy(profile["fga"]))
    fg_pct = clamp(rng.gauss(profile["fg_pct"], 0.05), 0.25, 0.75)
    fgm = min(fga, round(fga * fg_pct))

    fg3a = min(fga, round(noisy(profile["fg3a"])))
    fg3_pct = clamp(rng.gauss(profile["fg3_pct"], 0.06), 0.0, 0.60)
    fg3m = min(fgm, min(fg3a, round(fg3a * fg3_pct)))

    fta = round(noisy(profile["fta"]))
    ft_pct = clamp(rng.gauss(profile["ft_pct"], 0.05), 0.40, 0.95)
    ftm = min(fta, round(fta * ft_pct))

    oreb = round(noisy(profile["oreb"]))
    dreb = round(noisy(profile["dreb"]))
    ast = round(noisy(profile["ast"]))
    stl = round(noisy(profile["stl"]))
    blk = round(noisy(profile["blk"]))
    tov = round(noisy(profile["tov"], 0.30))
    pf = min(5, round(noisy(profile["pf"], 0.25)))

    points = 2 * (fgm - fg3m) + 3 * fg3m + ftm

    return dict(
        minutes=round(minutes, 1), points=points, fgm=fgm, fga=fga,
        fg3m=fg3m, fg3a=fg3a, ftm=ftm, fta=fta, oreb=oreb, dreb=dreb,
        ast=ast, stl=stl, blk=blk, tov=tov, pf=pf,
    )


def seed(conn, seed_value=20260101):
    """Populate an initialized (empty) db with teams, players, games, stats."""
    rng = random.Random(seed_value)
    team_lookup = {t[0]: t for t in TEAMS}
    cur = conn.cursor()

    for team_id, name, division, conference, tempo, _strength in TEAMS:
        cur.execute(
            "INSERT INTO team (team_id, name, division, conference, season, tempo, rating) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (team_id, name, division, conference, SEASON, tempo, 1600.0),
        )

    for player_id, name, team_id, position, class_year, height_in, _base_min, _profile in PLAYERS:
        cur.execute(
            "INSERT INTO player (player_id, name, team_id, position, class_year, height_in) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (player_id, name, team_id, position, class_year, height_in),
        )

    schedule_pairs = build_schedule()
    start_date = date(2025, 11, 5)
    games = []

    for idx, (team_a, team_b) in enumerate(schedule_pairs):
        home_id, away_id = (team_a, team_b) if idx % 2 == 0 else (team_b, team_a)
        home = team_lookup[home_id]
        away = team_lookup[away_id]

        home_score, away_score = simulate_score(home[5], away[5], home[4], away[4], rng)
        game_id = "g%04d" % (idx + 1)
        game_date = (start_date + timedelta(days=idx)).isoformat()

        cur.execute(
            "INSERT INTO game (game_id, season, date, home_team_id, away_team_id, home_score, away_score) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (game_id, SEASON, game_date, home_id, away_id, home_score, away_score),
        )
        games.append(dict(
            game_id=game_id, home_team_id=home_id, away_team_id=away_id,
            home_score=home_score, away_score=away_score,
        ))

    games_by_team = {}
    for g in games:
        games_by_team.setdefault(g["home_team_id"], []).append(g)
        games_by_team.setdefault(g["away_team_id"], []).append(g)

    for player_id, name, team_id, position, class_year, height_in, base_minutes, profile in PLAYERS:
        team_games = games_by_team.get(team_id, [])[:8]
        for g in team_games:
            is_home = g["home_team_id"] == team_id
            team_score = g["home_score"] if is_home else g["away_score"]
            opp_score = g["away_score"] if is_home else g["home_score"]
            opponent_id = g["away_team_id"] if is_home else g["home_team_id"]
            margin = team_score - opp_score

            minutes = minutes_for_game(base_minutes, abs(margin), rng)
            stat = stat_line_from_per40(profile, minutes, rng)
            started = 1 if base_minutes >= 20 else 0

            cur.execute(
                "INSERT INTO player_game_stat (player_id, game_id, team_id, opponent_id, minutes, "
                "points, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf, started, margin) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    player_id, g["game_id"], team_id, opponent_id, stat["minutes"],
                    stat["points"], stat["fgm"], stat["fga"], stat["fg3m"], stat["fg3a"],
                    stat["ftm"], stat["fta"], stat["oreb"], stat["dreb"], stat["ast"],
                    stat["stl"], stat["blk"], stat["tov"], stat["pf"], started, margin,
                ),
            )

    conn.commit()
