"""Team strength ratings -- the 'competition network'.

Every game (including D1-vs-D2 crossover games) is one edge in a
connected graph. We run a margin-of-victory-aware Elo update over the
full game list for several epochs (shrinking the learning rate each
pass) so that ratings settle into a consistent order even with a
sparse crossover schedule. This lets a D2 team's rating be informed
by a chain like: D2 school loses to a mid-major, which lost to a
blueblood, which beat another blueblood -- exactly the network effect
described in the product spec.
"""

import math


def elo_update(rating_a, rating_b, margin, k=24, home_adv=0.0):
    """One Elo update for a single game between team A and team B.

    margin: team_a_score - team_b_score (positive if A won).
    Returns (new_rating_a, new_rating_b).
    """
    expected_a = 1.0 / (1.0 + 10 ** ((rating_b - (rating_a + home_adv)) / 400.0))

    if margin > 0:
        actual_a = 1.0
    elif margin < 0:
        actual_a = 0.0
    else:
        actual_a = 0.5

    mov_mult = math.log(abs(margin) + 1) + 1.0
    change = k * mov_mult * (actual_a - expected_a)

    return rating_a + change, rating_b - change


def compute_team_ratings(team_ids, games, base_rating=1600.0, epochs=6, base_k=32.0):
    """Compute a converged strength rating for every team.

    team_ids: iterable of team_id strings.
    games: iterable of dicts with home_team_id, away_team_id,
        home_score, away_score.
    Returns a dict {team_id: rating}.
    """
    ratings = {team_id: base_rating for team_id in team_ids}

    for epoch in range(1, epochs + 1):
        k = base_k / epoch
        for g in games:
            home_id = g["home_team_id"]
            away_id = g["away_team_id"]
            margin = g["home_score"] - g["away_score"]

            r_home = ratings[home_id]
            r_away = ratings[away_id]
            new_home, new_away = elo_update(r_home, r_away, margin, k=k)
            ratings[home_id] = new_home
            ratings[away_id] = new_away

    return ratings
