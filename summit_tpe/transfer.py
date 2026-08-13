"""Transfer translation -- the flagship feature, v0 heuristic.

Given a player's season summary (from pdi.evaluate_player_season) and
a candidate destination team, project what she'd likely produce there:
expected minutes, PPG, RPG, APG, PDI, and starter probability.

This first pass uses simple, transparent ratios (pace and team-strength
gap) rather than a trained model. Once there's real historical
transfer outcome data (player moves school, we observe what actually
happened), this should be replaced by a model fit on those outcomes --
this heuristic is a placeholder to prove the pipeline end to end.
"""

from .utils import clamp, logistic


def project_transfer(season_summary, pdi, current_team, dest_team):
    """Project a player's stat line and PDI at a destination team.

    season_summary: dict from pdi.evaluate_player_season.
    pdi: the player's current PDI (float).
    current_team / dest_team: dicts with name, tempo, rating.
    """
    pace_factor = dest_team["tempo"] / current_team["tempo"]
    strength_gap = dest_team["rating"] - current_team["rating"]

    # Moving up in competition compresses usage/efficiency a bit;
    # moving down inflates it. Both are capped so the heuristic never
    # runs away.
    production_factor = clamp(1.0 - strength_gap / 2500.0, 0.70, 1.12)
    minutes_factor = clamp(1.0 - strength_gap / 3200.0, 0.55, 1.05)

    projected_minutes = clamp(season_summary["avg_minutes"] * minutes_factor, 4.0, 36.0)
    projected_per40_pts = season_summary["per40_pts"] * pace_factor * production_factor
    projected_per40_reb = season_summary["per40_reb"] * production_factor
    projected_per40_ast = season_summary["per40_ast"] * production_factor

    projected_ppg = projected_per40_pts * projected_minutes / 40.0
    projected_rpg = projected_per40_reb * projected_minutes / 40.0
    projected_apg = projected_per40_ast * projected_minutes / 40.0

    pdi_shift = clamp(-strength_gap / 400.0, -6.0, 3.0)
    projected_pdi = round(clamp(pdi + pdi_shift, 30.0, 99.0), 1)

    starter_probability = round(logistic((projected_minutes - 21.0) / 4.0), 2)

    return {
        "destination": dest_team["name"],
        "projected_minutes": round(projected_minutes, 1),
        "projected_ppg": round(projected_ppg, 1),
        "projected_rpg": round(projected_rpg, 1),
        "projected_apg": round(projected_apg, 1),
        "projected_pdi": projected_pdi,
        "starter_probability": starter_probability,
    }
