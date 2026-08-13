"""Shared computation core for Summit TPE: position-weighted Hoop Score,
iterative team ratings, and conference tier classification. Used by both
build_cache.py (the once-per-season static precompute) and projection.py
(the live, on-demand transfer calculator).

This is the validated logic from compute_derived_sheets.py, factored out so
it isn't duplicated/re-diverged between the batch script and the live
calculator. See that script's module docstring for the full reasoning
behind each adaptation from the summit_tpe/ prototype (position buckets,
opponent-strength calibration, close-game weighting, etc.) -- not repeated
here.
"""

import math
import statistics
from collections import defaultdict

MIN_GAMES_FOR_PROFILE = 5
# A games-count floor alone isn't enough: a player can clear 5 games while
# barely playing in any of them (a real example from this data: 7 games
# totaling 21 minutes, some as short as 1 minute, still ranked #1 in the
# country on the old per-game-average approach below). Require a real
# season-length sample of PLAYING TIME too, not just games appeared in.
MIN_TOTAL_MINUTES_FOR_PROFILE = 100
# Per-40 extrapolation blows up for very short stints (1 minute, 5 points
# -> a "200 PPG pace" game). Floor the minutes used in the 40/minutes
# scale factor so no single game can be stretched further than a 4x
# extrapolation (equivalent to treating anything under 10 minutes as if it
# were exactly 10) -- tempers single-game outliers without needing to
# throw the game out entirely.
PER40_MINUTES_FLOOR = 10
TOL = 1e-4
MAX_ITER = 200


def per40_scale(minutes):
    return 40.0 / max(minutes, PER40_MINUTES_FLOOR)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def logistic(x):
    return 1.0 / (1.0 + math.exp(-x))


# ---------- position weight buckets (collapsed from summit_tpe/pdi.py) ----------

_ORIGINAL = {
    "PG":      dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.4, dreb=0.30, ast=1.10, stl=1.10, blk=0.40, tov=-1.10, pf=-0.30),
    "SG":      dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.5, dreb=0.35, ast=0.80, stl=0.90, blk=0.40, tov=-1.00, pf=-0.30),
    "WING":    dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.6, dreb=0.45, ast=0.70, stl=0.85, blk=0.55, tov=-0.90, pf=-0.30),
    "FORWARD": dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=0.8, dreb=0.55, ast=0.50, stl=0.70, blk=0.75, tov=-0.80, pf=-0.35),
    "CENTER":  dict(pts=1.0, fgm=0.4, fga=-0.7, ftmiss=-0.4, oreb=1.0, dreb=0.65, ast=0.35, stl=0.55, blk=1.00, tov=-0.70, pf=-0.40),
}


def _collapse(*keys):
    dicts = [_ORIGINAL[k] for k in keys]
    out = {}
    for stat in dicts[0]:
        if stat in ("oreb", "dreb"):
            continue
        out[stat] = sum(d[stat] for d in dicts) / len(dicts)
    out["reb"] = sum((d["oreb"] + d["dreb"]) / 2.0 for d in dicts) / len(dicts)
    return out


BUCKET_WEIGHTS = {
    "GUARD": _collapse("PG", "SG"),
    "FORWARD": _collapse("WING", "FORWARD"),
    "CENTER": _collapse("CENTER"),
}
BUCKET_WEIGHTS["ALL"] = {
    stat: sum(BUCKET_WEIGHTS[b][stat] for b in ("GUARD", "FORWARD", "CENTER")) / 3.0
    for stat in BUCKET_WEIGHTS["GUARD"]
}

POSITION_TO_BUCKET = {
    "G": "GUARD", "PG": "GUARD", "SG": "GUARD",
    "F": "FORWARD", "SF": "FORWARD", "PF": "FORWARD", "ATH": "FORWARD",
    "C": "CENTER",
}

EXPERIENCE_MULT = {"FR": 1.03, "SO": 1.015, "JR": 1.0, "SR": 1.0, "GR": 0.995}


def composite_game_score(bucket, points, fgm, fga, ftmiss, reb, ast, stl, blk, tov, pf):
    w = BUCKET_WEIGHTS[bucket]
    return (
        points * w["pts"] + fgm * w["fgm"] + fga * w["fga"] + ftmiss * w["ftmiss"]
        + reb * w["reb"] + ast * w["ast"] + stl * w["stl"] + blk * w["blk"]
        + tov * w["tov"] + pf * w["pf"]
    )


def close_game_weight(margin):
    m = abs(margin)
    if m <= 12:
        return 1.0
    return clamp(1.0 - (m - 12) / 18.0, 0.25, 1.0)


HOOPSCORE_LOW, HOOPSCORE_MID, HOOPSCORE_HIGH = 30.0, 60.0, 99.0
# tanh steepness for the z -> Hoop/Summit Score transform below. Calibrated
# against a real season of this cache's data: the old formula (a quadratic
# boost for z > 0, then hard-clamped to 99) sent real per-player z-scores as
# high as ~6 std devs (this composite is heavy-tailed, not close to normal --
# a handful of players legitimately separate from the pack by a huge margin)
# into unclamped values from 130 up to 244, all of which got flattened onto
# the exact same displayed 99.0. With real 2025-26 data that was 149 of 3,899
# current-season players (3.8%) all showing an indistinguishable "99" even
# though their actual production ranged enormously. K=1.5 keeps that same
# real data to about 5 players at the true 99.0 ceiling -- reserved for the
# genuinely best players in the country, not a top-5%-ish tier -- while
# spreading the rest of the elite tier out smoothly (e.g. the ~40th-best
# player nationally lands around 98, the ~200th-best around 93).
HOOPSCORE_TANH_K = 1.5


def scale_to_hoopscore(raw_by_key, mean=None, std=None):
    """Returns (displayed, unclamped, mean, std). `displayed` is what's shown
    to users, rounded to 1 decimal. `unclamped` is the same tanh-saturated
    value before rounding -- callers should still rank/sort on `unclamped`
    rather than `displayed` (see compute_derived_sheets.py), since rounding
    two very close real scores to the same 1-decimal display value is normal
    and expected, but sorting on the rounded value throws away real ordering
    information for no reason.

    Uses a tanh (not the old linear-plus-quadratic transform) specifically
    because tanh saturates smoothly toward the 30/99 bounds without ever
    needing a hard clamp for realistic inputs -- see HOOPSCORE_TANH_K above
    for why that matters: it's what stops a large cluster of distinct elite
    seasons from all piling up on the exact same displayed ceiling value.
    """
    values = list(raw_by_key.values())
    if mean is None:
        mean = statistics.mean(values) if values else 0.0
    if std is None:
        std = statistics.pstdev(values) if len(values) > 1 else 1.0
        std = std or 1.0
    displayed, unclamped = {}, {}
    for key, raw in raw_by_key.items():
        z = (raw - mean) / std
        if z >= 0:
            hs = HOOPSCORE_MID + (HOOPSCORE_HIGH - HOOPSCORE_MID) * math.tanh(z / HOOPSCORE_TANH_K)
        else:
            hs = HOOPSCORE_MID + (HOOPSCORE_MID - HOOPSCORE_LOW) * math.tanh(z / HOOPSCORE_TANH_K)
        unclamped[key] = hs
        # tanh already keeps hs strictly inside (LOW, HIGH) for any finite z --
        # this clamp is just a defensive floor/ceiling for pathological inputs
        # (e.g. std == 0), not something normal real data should ever hit.
        displayed[key] = round(clamp(hs, HOOPSCORE_LOW, HOOPSCORE_HIGH), 1)
    return displayed, unclamped, mean, std


# ---------- team strength: iterative Off/Def/Rat ----------

def iterative_off_def(games):
    """games: [(home_id, away_id, home_score, away_score), ...]. Returns (off, def_) dicts."""
    per_team_games = defaultdict(list)
    for h, a, hs, as_ in games:
        per_team_games[h].append((hs, as_, a))
        per_team_games[a].append((as_, hs, h))

    active = list(per_team_games.keys())
    if not active:
        return {}, {}

    off = {t: sum(s for s, _, _ in per_team_games[t]) / len(per_team_games[t]) for t in active}
    def_ = {t: sum(al for _, al, _ in per_team_games[t]) / len(per_team_games[t]) for t in active}

    for _ in range(MAX_ITER):
        league_off = sum(off.values()) / len(off)
        league_def = sum(def_.values()) / len(def_)
        new_off, new_def = {}, {}
        for t in active:
            gms = per_team_games[t]
            new_off[t] = sum((scored - def_[opp]) for scored, _, opp in gms) / len(gms) + league_def
            new_def[t] = sum((allowed - off[opp]) for _, allowed, opp in gms) / len(gms) + league_off
        max_change = max(
            max(abs(new_off[t] - off[t]) for t in active),
            max(abs(new_def[t] - def_[t]) for t in active),
        )
        off, def_ = new_off, new_def
        if max_change < TOL:
            break
    return off, def_


def compute_sos(games, rat):
    opponents = defaultdict(list)
    for h, a, _, _ in games:
        if h in rat and a in rat:
            opponents[h].append(rat[a])
            opponents[a].append(rat[h])
    return {t: sum(vals) / len(vals) for t, vals in opponents.items() if vals}


def opponent_strength_factor(opp_rating, reference, scale):
    scale = scale or 1.0
    return clamp(1.0 + (opp_rating - reference) / scale, 0.55, 1.6)


# ---------- conference tier classification ----------
# Confirmed with the user (not derived from data): the Big East is treated
# as a de facto 5th power conference for women's hoops, so "P4" is really a
# P5 group here. A handful of specific programs that historically punch
# above their conference's weight are hardcoded up to that same tier
# regardless of which conference they're actually in -- this is an
# explicit, user-specified list, not a statistical outlier detector, so it
# won't silently drift season to season the way a ratings-based rule would.

P5_CONFERENCES = {"ACC", "Big 10", "SEC", "Big 12", "Big East"}
MID_MAJOR_CONFERENCES = {"American", "Atlantic 10", "MWC", "WCC", "Coastal", "MVC"}
# Everything else observed in the Teams sheet's Conference column falls to Low-Major
# by default (Sun Belt, Metro, MAC, SWAC, ASUN, CUSA, Southland, Big West, Horizon,
# OVC, Patriot League, Big Sky, America East, Northeast, Summit, MEAC, Ivy League,
# Big South, Southern, WAC).

OUTLIER_P5_PROGRAMS = {"Gonzaga", "South Dakota State", "Princeton", "Florida Gulf Coast"}


def classify_tier(team_name, conference):
    if team_name in OUTLIER_P5_PROGRAMS:
        return "P5"
    if conference in P5_CONFERENCES:
        return "P5"
    if conference in MID_MAJOR_CONFERENCES:
        return "Mid-Major"
    return "Low-Major"
