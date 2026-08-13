"""Close-game possession weighting.

Per the product spec: a bucket scored in a 30-point blowout should
count far less than the same bucket scored in a game that stayed
within reach. We only have final-margin box scores in this prototype
(no play-by-play), so we approximate "meaningfulness" from the final
margin -- games decided by 12 or fewer get full weight, and weight
decays linearly out to a 30-point margin floor.

This is a simplification. A real implementation would use live win
probability at the moment of each play (garbage-time detection),
which requires play-by-play data.
"""

from .utils import clamp


def close_game_weight(margin):
    """Return a weight in [0.25, 1.0] based on final score margin.

    margin: signed or unsigned point differential for the game.
    """
    m = abs(margin)
    if m <= 12:
        return 1.0
    return clamp(1.0 - (m - 12) / 18.0, 0.25, 1.0)
