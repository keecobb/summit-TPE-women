"""Small numeric helpers shared across the engine."""

import math


def clamp(value, lo, hi):
    """Clamp value into [lo, hi]."""
    return max(lo, min(hi, value))


def logistic(x):
    """Standard logistic function, numerically guarded."""
    x = clamp(x, -50, 50)
    return 1.0 / (1.0 + math.exp(-x))
