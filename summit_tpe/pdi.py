"""The Projection Data Index (PDI) engine.

Pipeline per player, per game:
  1. Build a position-weighted box-score composite (a linear
     combination in the spirit of a standard "game score" formula,
     but with different stat weights per position so guards aren't
     punished for low rebounds and bigs aren't punished for low
     assists).
  2. Normalize to a per-40-minute rate (so a 6th player's efficient
     16 minutes isn't buried by a starter's empty 30).
  3. Multiply by an opponent-strength factor from the team rating
     network (a bucket against a strong team is worth more).
  4. Weight each game's contribution by close-game weight (see
     weighting.py) and a light reliability factor for very short
     stints, then take a weighted average across the season.
  5. Apply a small experience adjustment.
  6. Convert the resulting raw season score into a 30-99 PDI using a
     non-linear (z-score + convexity) transform, so separation gets
     wider as you move up the talent pool -- an 80-to-85 jump is not
     the same as a 95-to-Top jump.

Every constant here (position weights, opponent-factor scale,
experience multipliers, the PDI curve) is a first-pass placeholder.
The real version should be fit against multiple seasons of actual
outcomes (including real transfer results), not hand-tuned.
"""

import statistics

from .utils import clamp
from .weighting import close_game_weight

POSITION_WEIGHTS = {
    "PG":      dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.4, dreb=0.30, ast=1.10, stl=1.10, blk=0.40, tov=-1.10, pf=-0.30),
    "SG":      dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.5, dreb=0.35, ast=0.80, stl=0.90, blk=0.40, tov=-1.00, pf=-0.30),
    "WING":    dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.6, dreb=0.45, ast=0.70, stl=0.85, blk=0.55, tov=-0.90, pf=-0.30),
    "FORWARD": dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.8, dreb=0.55, ast=0.50, stl=0.70, blk=0.75, tov=-0.80, pf=-0.35),
    "CENTER":  dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=1.0, dreb=0.65, ast=0.35, stl=0.55, blk=1.00, tov=-0.70, pf=-0.40),
}

EXPERIENCE_MULT = {"FR": 1.03, "SO": 1.015, "JR": 1.0, "SR": 1.0, "GR": 0.995}


def opponent_strength_factor(opp_rating, reference=1600.0, scale=800.0):
    """Convert an opponent's Elo-style rating into a value multiplier."""
    return clamp(1.0 + (opp_rating - reference) / scale, 0.55, 1.6)


def composite_game_score(stat, position):
    """Position-weighted linear box-score composite for one game."""
    w = POSITION_WEIGHTS[position]
    ft_missed = stat["fta"] - stat["ftm"]
    return (
        stat["points"] * w["pts"]
        + stat["fgm"] * w["fgm"]
        + stat["fga"] * w["fga"]
        + ft_missed * w["ftmiss"]
        + stat["oreb"] * w["oreb"]
        + stat["dreb"] * w["dreb"]
        + stat["ast"] * w["ast"]
        + stat["stl"] * w["stl"]
        + stat["blk"] * w["blk"]
        + stat["tov"] * w["tov"]
        + stat["pf"] * w["pf"]
    )


def evaluate_player_season(position, class_year, game_rows, team_ratings):
    """Roll a player's game log up into a season summary.

    game_rows: list of dicts, each a player_game_stat row (plus
        opponent_id and margin).
    team_ratings: dict {team_id: rating} from ratings.compute_team_ratings.

    Returns a dict with season_raw (the PDI engine's internal value
    score, not yet scaled) plus human-readable per-40 rates.
    """
    values = []
    weights = []
    per40_pts_list = []
    per40_reb_list = []
    per40_ast_list = []
    minutes_total = 0.0

    for row in game_rows:
        minutes = max(row["minutes"], 1.0)
        per40_scale = 40.0 / minutes

        raw = composite_game_score(row, position)
        composite_per40 = raw * per40_scale

        opp_rating = team_ratings.get(row["opponent_id"], 1600.0)
        opp_factor = opponent_strength_factor(opp_rating)
        adjusted_value = composite_per40 * opp_factor

        cgw = close_game_weight(row["margin"])
        reliability = clamp(minutes / 15.0, 0.3, 1.0)
        weight = cgw * reliability

        values.append(adjusted_value)
        weights.append(weight)

        per40_pts_list.append(row["points"] * per40_scale)
        per40_reb_list.append((row["oreb"] + row["dreb"]) * per40_scale)
        per40_ast_list.append(row["ast"] * per40_scale)
        minutes_total += minutes

    weight_sum = sum(weights)
    if weight_sum <= 0 or not values:
        season_raw = sum(values) / max(1, len(values)) if values else 0.0
    else:
        season_raw = sum(v * w for v, w in zip(values, weights)) / weight_sum

    season_raw *= EXPERIENCE_MULT.get(class_year, 1.0)

    games_played = len(game_rows)
    avg_minutes = minutes_total / games_played if games_played else 0.0
    per40_pts = sum(per40_pts_list) / games_played if games_played else 0.0
    per40_reb = sum(per40_reb_list) / games_played if games_played else 0.0
    per40_ast = sum(per40_ast_list) / games_played if games_played else 0.0

    return {
        "season_raw": season_raw,
        "games_played": games_played,
        "avg_minutes": avg_minutes,
        "per40_pts": per40_pts,
        "per40_reb": per40_reb,
        "per40_ast": per40_ast,
    }


def scale_to_pdi(season_raw_by_player):
    """Map raw engine scores onto the 30-99 PDI scale, non-linearly.

    Uses a z-score against the current player pool, then adds a
    convex bonus for above-average players so the gap widens as you
    move toward the top of the scale (elite talent is rarer).
    """
    values = list(season_raw_by_player.values())
    if len(values) < 2:
        mean = values[0] if values else 0.0
        std = 1.0
    else:
        mean = statistics.mean(values)
        std = statistics.pstdev(values) or 1.0

    pdi_by_player = {}
    for player_id, raw in season_raw_by_player.items():
        z = (raw - mean) / std
        pdi = 60.0 + 12.0 * z + 3.0 * max(0.0, z) ** 2
        pdi_by_player[player_id] = round(clamp(pdi, 30.0, 99.0), 1)

    return pdi_by_player
