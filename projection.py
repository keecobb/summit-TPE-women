"""The live transfer calculator. A player's season profile (from the
cache, built once per season by build_cache.py) is static; the target team
and minutes are supplied per call, so the same player can be projected
against many different schools without recomputing her underlying stats
each time.
 
Adapted from summit_tpe/transfer.py: no pace/tempo term (Teams has no
possessions field), and strength_gap is computed from the EXACT target
team's Current Rating -- not a tier average -- since a coach picks a
specific school, not a tier. strength_gap is expressed in units of the
league's Rat standard deviation (stored in the cache's meta table at
build time) so the production/minutes/hoop-score sensitivity stays
correctly scaled regardless of the actual Rat numbers in a given season.
 
A team's Current Rating is already opponent-adjusted (it comes out of the
same iterative Off/Def solve as Summit Rat), so it already carries a
strength-of-schedule signal -- that's deliberately the ONLY strength input
here rather than also folding in the Teams sheet's SoS column separately,
which would mostly double-count the same thing.
 
Calibration note (3rd pass -- fit against real transfers, not guesses):
the 2nd-pass constants were still hand-picked and sanity-checked against
only a couple of manual examples. This pass instead used the ~1,359 REAL
transfers findable in the workbook itself: PlayerSeasons tracks each
player's team by season across all 3 years, so a player whose team_id
changes between two consecutive seasons is an actual, real transfer with
a real before/after per-40 stat line. For each one, the strength gap
between her old team's rating (in the old season) and new team's rating
(in the new season) was computed, bucketed, and compared against her
actual per40_pts change.
 
The result: production_factor is now a straight line fit through the
MEDIAN actual outcome in each strength-gap bucket (median, not mean, so a
single wild outlier -- e.g. one real player who jumped from 5.9 to 18.2
points-per-40 after transferring down -- doesn't dominate a bucket of 98
real cases). The bounds are set just past the actual observed range of
real transfers in this data (~+/-2.5 SD) rather than chasing that single
most extreme case -- per the explicit instruction that drove this pass:
cover the realistic range of real transfers well, without being shaped by
the rare outlier.
 
Two important honest caveats even after this refit:
1. Correlation between predicted and actual was moderate (~0.37) -- real
   transfers are also driven by normal year-over-year player development,
   role/usage changes at the new school, and single-season sample noise,
   none of which this can see. This is a real, data-grounded curve, not a
   precise forecast.
2. The intercept came out to ~1.06, not 1.00 -- real transfers average a
   small production bump beyond what pure team-strength math predicts,
   most likely because players who transfer are self-selecting for a
   bigger role or a better fit, not a random sample. That's baked into
   the curve below (see PRODUCTION_FACTOR_INTERCEPT) since it's a real,
   observed pattern, not noise -- but it's part of why any single
   projection should be read as a reasoned estimate, not a guarantee.
 
Minutes were deliberately NOT refit the same way. The equivalent real-data
fit for avg-minutes-per-game showed an enormous, obviously confounded
signal (players who transfer down a tier saw minutes roughly 2.5x their
old average) -- that's not "how many minutes would a specific player earn
in a specific team's rotation," it's "players largely transfer BECAUSE
they want more playing time, and mostly get it," which would badly
overstate minutes if baked into an auto-formula. That's exactly why minutes
now default to a role-based system anchored to the TARGET team's actual
current roster (see team_roles() below) instead of a strength-gap formula
-- a coach picking "Starter" or "Sixth Man" is setting the role directly
from real data about that specific roster, which sidesteps the confound
entirely. minutes_override (manual entry) always remains available and
always wins if given.
 
---- v2 additions (this pass) ----
 
1. projected_range / projected_range_wide on every projection: a numeric
   band around the point estimate instead of just a single number + a
   High/Medium/Low label. UPDATED (v2.1): compute_transfer_calibration_spread.py
   was run against the real workbook and found 1,553 real transfers (same
   detection method as the production_factor point-estimate fit above --
   a player whose Team ID changes between two consecutive seasons), this
   time bucketed by gap_std with the FULL percentile spread of actual
   per40_pts change per bucket (p10/p25/median/p75/p90), not just the
   median. TRANSFER_SPREAD_TABLE below is that real output. ppg/rpg/apg/
   bpg/spg/topg's range now come from those real percentiles (interpolated
   between bucket centers, converted to a ratio around this player's own
   production_factor point estimate so the range stays centered on the
   model's actual estimate rather than the bucket's raw median):
     - projected_range      = p25-p75 (the real IQR -- roughly the middle
       50% of what actually happened to real transfers at this strength
       gap)
     - projected_range_wide = p10-p90 (roughly the middle 80%)
   Honest caveats that still apply: (a) buckets are thin at the extremes
   (14 real cases at -2.0 SD, 22 at +2.0 SD, and +/-2.5 SD were dropped
   entirely for having fewer than 5) -- interpolation clamps to the
   +/-2.0 SD boundary rather than extrapolating past real data, but a
   14-22 case bucket is still a small sample; (b) this spread was only
   fit against per40_pts, same as the point estimate -- reb/ast/blk/stl
   inherit the same production_factor (and now the same real spread
   ratio) by the same extrapolation assumption the point estimate already
   makes, not an independent fit per stat. Minutes and hoop_score were
   NOT part of this real-data refit (see the minutes confound note above,
   and hoop_score is a derived composite, not per40_pts itself) -- their
   range width still uses the confidence-tier heuristic from v2.0. Said
   explicitly in projected_range_note on every response, not just here.
 
2. team_needs() / find_fits(): a team's roster-weighted per-40 category
   profile (built once in build_cache.py's team_profile table) compared
   against the rest of the league to find the team's weakest statistical
   category, then every other team's players ranked by their PROJECTED
   contribution to that category at this team specifically. Reuses the
   exact same math as project_player() via _core_projection() below, so a
   "fit" ranking and a one-off /project call always agree.
 
3. project_batch(): the same projection for multiple players against one
   target team in a single call, plus a simple combined production total
   -- for "I've got 2 scholarships and 5 names" instead of one lookup at
   a time.
 
4. player_trajectory(): season-over-season profile from the new
   player_history table (build_cache.py now computes every season, not
   just the current one), with a simple labeled up/down/flat trend.
"""
 
import random
import sqlite3
import statistics
from collections import defaultdict
 
from summit_calc import clamp, normalize_tier
from summit_calc import TIERS as VALID_LEVELS
 
# Fit directly against ~1,359 real transfers in the workbook (see
# calibration note above): actual_factor = INTERCEPT + slope * gap_std,
# where slope = -1/DENOM_STD. Bounds are set just past the real observed
# range of actual transfers (~+/-2.5 SD) in this data.
PRODUCTION_FACTOR_INTERCEPT = 1.06
PRODUCTION_FACTOR_DENOM_STD = 5.85
PRODUCTION_FACTOR_BOUNDS = (0.65, 1.45)
# Minutes are NOT fit from real transfer outcomes -- see calibration note
# above for the self-selection confound that ruled that out. This remains
# a hand-picked, conservative fallback used only when a coach doesn't pick
# a role or type in exact minutes.
MINUTES_FACTOR_BOUNDS = (0.55, 1.10)
MINUTES_FACTOR_DENOM_STD = 6.4
HOOPSCORE_SHIFT_BOUNDS = (-10.0, 6.0)
HOOPSCORE_DENOM_STD = 0.8
# TS%/FG% have a separate, tighter, physically-motivated ceiling/floor --
# unlike counting stats, shooting efficiency is bounded by shot mechanics/
# FT rates, and a full-season average above ~80% is essentially unheard of
# in real basketball even against very weak competition. Not refit against
# real data this pass (only per40_pts was) -- still a placeholder.
TS_BOUNDS = (0.20, 0.80)
 
# Still used for MINUTES and HOOP SCORE range width only (see honesty note
# (1) in the module docstring) -- those weren't part of the real-percentile
# refit below, so their spread remains a reasoned band scaled by confidence
# tier, not a fitted statistical interval.
CONFIDENCE_RANGE_FRACTION = {"High": 0.35, "Medium": 0.55, "Low": 0.80}
 
# Real output of compute_transfer_calibration_spread.py, run against the
# live corrected workbook 2026-08-12: 1,553 real transfers (a player whose
# Team ID changed between two consecutive seasons in PlayerSeasons -- same
# detection method as the production_factor point-estimate fit above),
# bucketed by gap_std, percentiles of the actual per40_pts factor
# (per40_pts in the new season / per40_pts in the old season) observed in
# each bucket. Buckets with fewer than 5 real cases (-2.5, +2.5 SD) were
# dropped as too thin to trust. (gap_std_center, p10, p25, median, p75, p90, n)
TRANSFER_SPREAD_TABLE = [
    (-2.0, 0.92, 1.05, 1.26, 1.47, 1.92, 14),
    (-1.5, 0.87, 1.00, 1.38, 1.66, 2.06, 46),
    (-1.0, 0.85, 0.99, 1.18, 1.51, 1.91, 154),
    (-0.5, 0.79, 0.98, 1.14, 1.45, 1.86, 291),
    (0.0, 0.69, 0.83, 0.99, 1.27, 1.59, 419),
    (0.5, 0.66, 0.81, 0.98, 1.18, 1.44, 338),
    (1.0, 0.56, 0.70, 0.84, 1.04, 1.24, 191),
    (1.5, 0.53, 0.66, 0.81, 0.94, 1.15, 74),
    (2.0, 0.56, 0.69, 0.74, 1.00, 1.14, 22),
]
 
 
def _interp_spread(gap_std):
    """Linearly interpolates (p10, p25, median, p75, p90) of the real
    actual-production-factor distribution at this gap_std, between the two
    nearest TRANSFER_SPREAD_TABLE bucket centers. Clamps to the table's
    +/-2.0 SD boundary rather than extrapolating past real observed data
    for anything more extreme."""
    lo_x, hi_x = TRANSFER_SPREAD_TABLE[0][0], TRANSFER_SPREAD_TABLE[-1][0]
    g = clamp(gap_std, lo_x, hi_x)
    for (x0, p10_0, p25_0, med_0, p75_0, p90_0, _n0), (x1, p10_1, p25_1, med_1, p75_1, p90_1, _n1) in zip(
        TRANSFER_SPREAD_TABLE, TRANSFER_SPREAD_TABLE[1:]
    ):
        if x0 <= g <= x1:
            t = (g - x0) / (x1 - x0) if x1 != x0 else 0.0
            lerp = lambda a, b: a + (b - a) * t
            return dict(p10=lerp(p10_0, p10_1), p25=lerp(p25_0, p25_1), median=lerp(med_0, med_1),
                        p75=lerp(p75_0, p75_1), p90=lerp(p90_0, p90_1))
    # shouldn't hit given the clamp above, but fall back to nearest edge
    edge = TRANSFER_SPREAD_TABLE[0] if g <= lo_x else TRANSFER_SPREAD_TABLE[-1]
    return dict(p10=edge[1], p25=edge[2], median=edge[3], p75=edge[4], p90=edge[5])
 
# ---------- role-based minutes (see calibration note above) ----------
# Coaches set a player's role at the TARGET team, computed from that
# team's own current roster's actual minutes distribution -- e.g. "Starter"
# at a deep, veteran team means something different than "Starter" at a
# thin roster, and this reflects that instead of using one flat number.
# Ranks are by avg_minutes among that team's own rotation players (the same
# >=5 games / >=100 total minutes floor already used for cache eligibility
# -- see summit_calc.py). manual minutes_override always remains available
# and always takes priority over a role.
ROLE_STARTER_COUNT = 5
ROLE_SIXTH_MAN_RANK = 6
ROLE_DEPTH_RANK_START = 7
ROLE_DEPTH_RANK_END = 10
ROLE_PLAYER_FRACTION_LOW = 0.60
ROLE_PLAYER_FRACTION_HIGH = 0.80
ROLE_NAMES = ("starter", "sixth_man", "role_player", "depth_piece")
 
# |strength_gap| / std beyond which a projection is flagged as an extreme
# mismatch -- not blocked, just labeled, since these are the cases where
# the hand-picked clamps above are most likely doing the work instead of
# the underlying formula, and where real-world outcomes are hardest to
# predict from box-score rate stats alone. Freshmen/sophomores get a
# tighter threshold: their season is a smaller, noisier sample of a still-
# developing player, so the same statistical gap deserves more caution
# sooner. This governs the flag only -- the projected numbers themselves
# are computed identically regardless of class year.
EXTREME_MISMATCH_STD = 2.0
EXTREME_MISMATCH_STD_UNDERCLASS = 1.25
UNDERCLASS_YEARS = {"FR", "SO"}
 
# team_profile category -> (label, projected-per-game field it maps to on
# project_player()'s result, whether a HIGHER team rate is a weakness
# instead of a strength). Turnovers are the one category where more is
# worse, so its z-score gets flipped before ranking "biggest weakness."
CATEGORY_INFO = {
    "per40_pts":  dict(label="points",     proj_field="ppg",    lower_is_better=False),
    "per40_reb":  dict(label="rebounds",   proj_field="rpg",    lower_is_better=False),
    "per40_ast":  dict(label="assists",    proj_field="apg",    lower_is_better=False),
    "per40_blk":  dict(label="blocks",     proj_field="bpg",    lower_is_better=False),
    "per40_stl":  dict(label="steals",     proj_field="spg",    lower_is_better=False),
    "per40_tov":  dict(label="turnovers",  proj_field="topg",   lower_is_better=True),
    "ts_pct":     dict(label="true shooting %", proj_field="ts_pct", lower_is_better=False),
    "fg_pct":     dict(label="field goal %",    proj_field="fg_pct", lower_is_better=False),
}
 
# Same 3 tiers classify_tier() (summit_calc.py) assigns every team at cache
# build time -- see teams.tier in build_cache.py. VALID_LEVELS is imported
# from summit_calc.TIERS ("High-Major", "Mid-Major", "Low-Major") above --
# every level/own_level/opponent_level/target_level param below is run
# through normalize_tier() first, so an old "P5" value (a stale bookmark,
# an old integration) still resolves correctly instead of failing
# validation.

 
def _load_meta(conn):
    rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    out = dict(season=rows["season"], league_mean_rat=float(rows["league_mean_rat"]),
               league_std_rat=float(rows["league_std_rat"]))
    for stat in CATEGORY_INFO:
        mk, sk = f"league_mean_{stat}", f"league_std_{stat}"
        if mk in rows and sk in rows:
            out[mk] = float(rows[mk])
            out[sk] = float(rows[sk]) or 1.0
    return out
 
 
def get_player(conn, player_id):
    row = conn.execute("SELECT * FROM players WHERE player_id = ?", (player_id,)).fetchone()
    if row is None:
        return None
    cols = [d[0] for d in conn.execute("SELECT * FROM players LIMIT 0").description]
    return dict(zip(cols, row))
 
 
def get_team(conn, team_id):
    row = conn.execute("SELECT * FROM teams WHERE team_id = ?", (team_id,)).fetchone()
    if row is None:
        return None
    cols = [d[0] for d in conn.execute("SELECT * FROM teams LIMIT 0").description]
    return dict(zip(cols, row))
 
 
def _all_teams_by_id(conn):
    cols = [d[0] for d in conn.execute("SELECT * FROM teams LIMIT 0").description]
    return {row[0]: dict(zip(cols, row)) for row in conn.execute("SELECT * FROM teams").fetchall()}
 
 
def get_team_profile(conn, team_id):
    row = conn.execute("SELECT * FROM team_profile WHERE team_id = ?", (team_id,)).fetchone()
    if row is None:
        return None
    cols = [d[0] for d in conn.execute("SELECT * FROM team_profile LIMIT 0").description]
    return dict(zip(cols, row))
 
 
class ProjectionError(ValueError):
    pass
 
 
def team_roles(conn, team_id):
    """Computes the 4 role-based minutes values for a team from its own
    current roster (players meeting the cache's normal games/minutes
    eligibility floor, ranked by avg_minutes). Returns None fields where a
    team's roster doesn't have enough eligible players to fill a role
    (thin rosters, teams with lots of injuries/inactives this season, etc)
    rather than guessing.
    """
    rows = conn.execute(
        "SELECT name, avg_minutes FROM players WHERE team_id = ? ORDER BY avg_minutes DESC", (team_id,)
    ).fetchall()
    roster = [dict(name=r[0], avg_minutes=r[1]) for r in rows]
 
    starters = roster[:ROLE_STARTER_COUNT]
    starter_minutes = round(sum(p["avg_minutes"] for p in starters) / len(starters), 1) if starters else None
 
    sixth_man_minutes = None
    if len(roster) >= ROLE_SIXTH_MAN_RANK:
        sixth_man_minutes = round(roster[ROLE_SIXTH_MAN_RANK - 1]["avg_minutes"], 1)
 
    depth = roster[ROLE_DEPTH_RANK_START - 1:ROLE_DEPTH_RANK_END]
    depth_minutes = round(sum(p["avg_minutes"] for p in depth) / len(depth), 1) if depth else None
 
    role_player_minutes = None
    role_player_range = None
    if starter_minutes is not None:
        lo = round(starter_minutes * ROLE_PLAYER_FRACTION_LOW, 1)
        hi = round(starter_minutes * ROLE_PLAYER_FRACTION_HIGH, 1)
        role_player_minutes = round((lo + hi) / 2.0, 1)
        role_player_range = [lo, hi]
 
    return dict(
        team_id=team_id,
        roster_size=len(roster),
        starter=dict(minutes=starter_minutes, player_count=len(starters)),
        sixth_man=dict(minutes=sixth_man_minutes),
        role_player=dict(minutes=role_player_minutes, range=role_player_range,
                          note="60-80% of the starter average -- the player 'setting the role' by minutes, "
                               "not a specific roster rank"),
        depth_piece=dict(minutes=depth_minutes, player_count=len(depth),
                          note="average of the team's #7-#10 rotation players by minutes"),
    )
 
 
def _core_projection(player, current_team, target_team, meta, minutes_override=None, role=None, role_info=None):
    """The actual projection math, independent of how player/current_team/
    target_team/role_info were fetched -- shared by project_player() (one
    SQL lookup per call) and find_fits() (bulk-loads every candidate once,
    then calls this in a plain Python loop so ranking hundreds of players
    doesn't mean hundreds of round trips)."""
    std = meta["league_std_rat"]
 
    strength_gap = target_team["current_rating"] - current_team["current_rating"]
    gap_std = strength_gap / std if std else 0.0
 
    production_factor = clamp(
        PRODUCTION_FACTOR_INTERCEPT - strength_gap / (PRODUCTION_FACTOR_DENOM_STD * std), *PRODUCTION_FACTOR_BOUNDS
    )
    minutes_factor = clamp(1.0 - strength_gap / (MINUTES_FACTOR_DENOM_STD * std), *MINUTES_FACTOR_BOUNDS)
    hoopscore_shift = clamp(-strength_gap / (HOOPSCORE_DENOM_STD * std), *HOOPSCORE_SHIFT_BOUNDS)
 
    minutes_source = "auto_projected"
    if minutes_override is not None:
        if minutes_override < 0 or minutes_override > 40:
            raise ProjectionError("minutes_override must be between 0 and 40.")
        proj_minutes = minutes_override
        minutes_source = "coach_override"
    elif role is not None:
        if role_info is None or role_info.get("minutes") is None:
            raise ProjectionError(
                f"Can't resolve role '{role}' for {target_team['name']} -- not enough rotation "
                f"players on record for that team this season to compute it. Use minutes_override instead."
            )
        proj_minutes = role_info["minutes"]
        minutes_source = f"role:{role}"
    else:
        proj_minutes = clamp(player["avg_minutes"] * minutes_factor, 4.0, 36.0)
 
    def _at_factor(pf, mf):
        """Recompute the projected per-game line at an arbitrary
        (production_factor, minutes_factor) pair -- used both for the
        headline point estimate and for the low/high range."""
        pts = player["per40_pts"] * pf
        reb = player["per40_reb"] * pf
        ast = player["per40_ast"] * pf
        blk = player["per40_blk"] * pf if player["per40_blk"] is not None else None
        stl = player["per40_stl"] * pf if player["per40_stl"] is not None else None
        tov_factor = 2.0 * PRODUCTION_FACTOR_INTERCEPT - pf
        tov = player["per40_tov"] * tov_factor if player["per40_tov"] is not None else None
 
        if minutes_override is not None or role is not None:
            m = proj_minutes  # coach-set minutes don't move with the range
        else:
            m = clamp(player["avg_minutes"] * mf, 4.0, 36.0)
 
        ts = clamp(player["ts_pct"] * pf, *TS_BOUNDS) if player["ts_pct"] is not None else None
        fg = clamp(player["fg_pct"] * pf, *TS_BOUNDS) if player["fg_pct"] is not None else None
        return dict(
            minutes=m,
            ppg=pts * m / 40.0, rpg=reb * m / 40.0, apg=ast * m / 40.0,
            bpg=(blk * m / 40.0) if blk is not None else None,
            spg=(stl * m / 40.0) if stl is not None else None,
            topg=(tov * m / 40.0) if tov is not None else None,
            ts_pct=ts, fg_pct=fg,
        )
 
    point = _at_factor(production_factor, minutes_factor)
    proj_hoop_score = round(clamp(player["hoop_score_raw"] + hoopscore_shift, 30.0, 99.0), 1)
 
    is_underclass = player["class_year"] in UNDERCLASS_YEARS
    mismatch_threshold = EXTREME_MISMATCH_STD_UNDERCLASS if is_underclass else EXTREME_MISMATCH_STD
    extreme_mismatch = abs(gap_std) >= mismatch_threshold
 
    confidence = "High" if player["games"] >= 20 else ("Medium" if player["games"] >= 10 else "Low")
    tiers = ["Low", "Medium", "High"]
    if is_underclass:
        confidence = tiers[max(0, tiers.index(confidence) - 1)]
    if extreme_mismatch and confidence == "High":
        confidence = "Medium"
 
    # ---- projected_range / projected_range_wide: see honesty note (1) in
    # the module docstring. ppg/rpg/apg/bpg/spg/topg now come from
    # TRANSFER_SPREAD_TABLE -- real percentiles of what actually happened
    # to real transfers at this gap_std, converted to a ratio around this
    # player's OWN production_factor point estimate (so the range stays
    # centered on the model's actual estimate, not the bucket's raw
    # median, which can differ slightly from the separately-fit point-
    # estimate line). Minutes and hoop_score still use the confidence-tier
    # heuristic (frac) -- they were not part of this real-data refit.
    frac = CONFIDENCE_RANGE_FRACTION[confidence]
    mf_lo = clamp(minutes_factor - frac * (minutes_factor - MINUTES_FACTOR_BOUNDS[0]), *MINUTES_FACTOR_BOUNDS)
    mf_hi = clamp(minutes_factor + frac * (MINUTES_FACTOR_BOUNDS[1] - minutes_factor), *MINUTES_FACTOR_BOUNDS)
 
    spread = _interp_spread(gap_std)
    median = spread["median"] or 1.0
    pf_p10 = clamp(production_factor * (spread["p10"] / median), *PRODUCTION_FACTOR_BOUNDS)
    pf_p25 = clamp(production_factor * (spread["p25"] / median), *PRODUCTION_FACTOR_BOUNDS)
    pf_p75 = clamp(production_factor * (spread["p75"] / median), *PRODUCTION_FACTOR_BOUNDS)
    pf_p90 = clamp(production_factor * (spread["p90"] / median), *PRODUCTION_FACTOR_BOUNDS)
 
    # Turnovers move OPPOSITE production_factor (tov_factor = 2*INTERCEPT -
    # pf -- see _at_factor), unlike every other stat here. Pairing a "low"
    # pf with a "low" minutes factor (as if every stat moves the same
    # direction as both) silently inverts topg's range. Instead of assuming
    # a direction, compute all 4 (pf, minutes) corners per tier and take
    # the actual min/max per stat -- correct regardless of which way a
    # given stat moves relative to pf.
    def _corners(pf_lo, pf_hi):
        return [_at_factor(pf, mf) for pf in (pf_lo, pf_hi) for mf in (mf_lo, mf_hi)]
 
    likely_corners = _corners(pf_p25, pf_p75)
    wide_corners = _corners(pf_p10, pf_p90)
 
    hs_lo = round(clamp(player["hoop_score_raw"] + hoopscore_shift - frac * (hoopscore_shift - HOOPSCORE_SHIFT_BOUNDS[0]), 30.0, 99.0), 1)
    hs_hi = round(clamp(player["hoop_score_raw"] + hoopscore_shift + frac * (HOOPSCORE_SHIFT_BOUNDS[1] - hoopscore_shift), 30.0, 99.0), 1)
 
    def _rng(corners, key, ndigits=1):
        vals = [c[key] for c in corners if c.get(key) is not None]
        if not vals:
            return None
        return [round(min(vals), ndigits), round(max(vals), ndigits)]
 
    projected_range = dict(
        ppg=_rng(likely_corners, "ppg"), rpg=_rng(likely_corners, "rpg"),
        apg=_rng(likely_corners, "apg"), bpg=_rng(likely_corners, "bpg"),
        spg=_rng(likely_corners, "spg"), topg=_rng(likely_corners, "topg"),
        hoop_score=[min(hs_lo, hs_hi), max(hs_lo, hs_hi)],
    )
    projected_range_wide = dict(
        ppg=_rng(wide_corners, "ppg"), rpg=_rng(wide_corners, "rpg"),
        apg=_rng(wide_corners, "apg"), bpg=_rng(wide_corners, "bpg"),
        spg=_rng(wide_corners, "spg"), topg=_rng(wide_corners, "topg"),
    )
 
    result = dict(
        player=dict(id=player["player_id"], name=player["name"], position=player["position"],
                    class_year=player["class_year"], current_team=current_team["name"],
                    current_division=player["division"], current_tier=current_team["tier"],
                    games=player["games"], season=meta["season"]),
        current=dict(ppg=round(player["ppg"], 1), rpg=round(player["rpg"], 1), apg=round(player["apg"], 1),
                     bpg=round(player["bpg"], 1) if player.get("bpg") is not None else None,
                     spg=round(player["spg"], 1) if player.get("spg") is not None else None,
                     topg=round(player["topg"], 1) if player.get("topg") is not None else None,
                     ts_pct=round(player["ts_pct"] * 100, 1) if player["ts_pct"] is not None else None,
                     fg_pct=round(player["fg_pct"] * 100, 1) if player.get("fg_pct") is not None else None,
                     avg_minutes=round(player["avg_minutes"], 1), hoop_score=player["hoop_score"]),
        target=dict(team=target_team["name"], division=target_team["division"], tier=target_team["tier"],
                    current_rating=round(target_team["current_rating"], 2)),
        minutes_source=minutes_source,
        projected=dict(
            minutes=round(point["minutes"], 1), ppg=round(point["ppg"], 1), rpg=round(point["rpg"], 1),
            apg=round(point["apg"], 1), bpg=round(point["bpg"], 1) if point["bpg"] is not None else None,
            spg=round(point["spg"], 1) if point["spg"] is not None else None,
            topg=round(point["topg"], 1) if point["topg"] is not None else None,
            ts_pct=round(point["ts_pct"] * 100, 1) if point["ts_pct"] is not None else None,
            fg_pct=round(point["fg_pct"] * 100, 1) if point["fg_pct"] is not None else None,
            hoop_score=proj_hoop_score,
        ),
        projected_range=projected_range,
        projected_range_wide=projected_range_wide,
        projected_range_note=(
            "ppg/rpg/apg/bpg/spg/topg: real interquartile range (p25-p75, projected_range) and "
            "10th-90th percentile (p10-p90, projected_range_wide) of what actually happened to "
            "1,553 real transfers at a comparable strength gap (see TRANSFER_SPREAD_TABLE in "
            "projection.py, from compute_transfer_calibration_spread.py) -- centered on this "
            "player's own point estimate, not a raw bucket median. Buckets are thin at extreme "
            "strength gaps (as few as 14-22 real cases beyond +/-1.5 SD). hoop_score's range, and "
            "minutes' contribution to all ranges, are still a reasoned heuristic scaled by "
            "confidence tier, not fit from real per-bucket spread."
        ),
        confidence=confidence,
        strength_gap=round(strength_gap, 2),
        gap_std=round(gap_std, 2),
        extreme_mismatch=extreme_mismatch,
    )
    if extreme_mismatch:
        # Reworded (phase 9) to stay honest about the gap being unusually
        # large without undermining trust in the projection itself -- the
        # old copy ("Extreme mismatch... projection may be conservative...
        # not a precise forecast") led with an alarming label, a vague
        # hedge, and a line that reads as "don't trust this number," none
        # of which is the intended message. This says the same true thing
        # (bigger gap than usual, so expect more spread) without the jargon
        # (no raw standard-deviation figure -- gap_std is still on the
        # response for anyone who wants it) or the trust-undermining tone.
        result["extreme_mismatch_note"] = (
            "This is one of the bigger jumps in competition level this tool projects. The estimate is "
            "still built the same way as every other projection here -- from real comparable transfers "
            "-- so trust the direction of the projection, but expect more game-to-game variation than "
            "usual for a jump this large."
        )
    if role is not None:
        result["role_applied"] = dict(role=role, **role_info)
    return result
 
 
def project_player(conn, player_id, target_team_id, minutes_override=None, role=None):
    """Returns a dict with the player's static current profile plus a
    projection at target_team_id.
 
    Minutes resolution, in priority order:
    1. minutes_override (coach types in an exact number) -- always wins if given.
    2. role ("starter" | "sixth_man" | "role_player" | "depth_piece") -- resolved
       from the TARGET team's own current roster via team_roles().
    3. Neither given -- falls back to a conservative auto-projection from the
       player's own current minutes (see MINUTES_FACTOR_* caveat above for why
       this fallback is intentionally NOT fit from real transfer data).
 
    The per-40 rates always get the production_factor adjustment for
    target-team strength regardless of which minutes path is used.
    """
    player = get_player(conn, player_id)
    if player is None:
        raise ProjectionError(f"No player with id {player_id} in the current-season cache.")
    if player.get("hoop_score_raw") is None:
        # A bare placeholder row (see build_cache.py) -- on the roster, but
        # zero games/box-score data anywhere this season, so there's no
        # real per-40 production to project from. Findable/viewable via
        # /players and /players/{id}, just not projectable.
        raise ProjectionError(f"{player.get('name', 'This player')} has no recorded games this season "
                               f"({player_id}) -- not enough data to project.")
    target_team = get_team(conn, target_team_id)
    if target_team is None:
        raise ProjectionError(f"No team with id {target_team_id} in the current-season cache.")
    current_team = get_team(conn, player["team_id"])
    if current_team is None:
        raise ProjectionError(f"Player's current team (id {player['team_id']}) isn't in the "
                               f"current-season cache -- can't compute a strength gap.")
 
    meta = _load_meta(conn)
 
    role_info = None
    if role is not None:
        if role not in ROLE_NAMES:
            raise ProjectionError(f"role must be one of {ROLE_NAMES}, got {role!r}.")
        roles = team_roles(conn, target_team_id)
        role_info = roles[role]
 
    return _core_projection(player, current_team, target_team, meta,
                             minutes_override=minutes_override, role=role, role_info=role_info)
 
 
# ---------- "who fits my team's biggest hole" (reverse lookup) ----------
 
def _level_comparison_stats(conn, level):
    """Live mean/std per team_profile category, computed only over teams
    whose tier == level (High-Major/Mid-Major/Low-Major), instead of the
    whole-league figures precomputed in the cache's meta table at build
    time. Cheap to compute per request (a few hundred teams at most), so
    this doesn't need to be precomputed for every tier up front the way
    the whole-league numbers are.
    """
    cols = [d[0] for d in conn.execute("SELECT * FROM team_profile LIMIT 0").description]
    rows = conn.execute(
        "SELECT tp.* FROM team_profile tp JOIN teams t ON tp.team_id = t.team_id WHERE t.tier = ?",
        (level,),
    ).fetchall()
    profiles = [dict(zip(cols, row)) for row in rows]
    stats = {}
    for stat in CATEGORY_INFO:
        vals = [p[stat] for p in profiles if p.get(stat) is not None]
        if vals:
            mean = statistics.mean(vals)
            std = (statistics.pstdev(vals) if len(vals) > 1 else 1.0) or 1.0
        else:
            mean, std = 0.0, 1.0
        stats[stat] = dict(mean=mean, std=std)
    return stats, len(profiles)


def _conference_comparison_means(conn, conference):
    """Plain per-category means for every team in one conference -- used
    only as an extra reference column on /teams/{id}/needs (a much smaller,
    more direct peer group than a whole tier), not for z-scoring. A
    conference with only one team (this one) still returns that team's own
    values with n_teams=1, since that's a legitimate (if unhelpful) answer
    rather than an error.
    """
    if not conference:
        return {}, 0
    cols = [d[0] for d in conn.execute("SELECT * FROM team_profile LIMIT 0").description]
    rows = conn.execute(
        "SELECT tp.* FROM team_profile tp JOIN teams t ON tp.team_id = t.team_id WHERE t.conference = ?",
        (conference,),
    ).fetchall()
    profiles = [dict(zip(cols, row)) for row in rows]
    means = {}
    for stat in CATEGORY_INFO:
        vals = [p[stat] for p in profiles if p.get(stat) is not None]
        means[stat] = statistics.mean(vals) if vals else None
    return means, len(profiles)


def team_needs(conn, team_id, top_n=3, level=None):
    """A team's roster-weighted per-40 category profile (team_profile,
    built once by build_cache.py) compared against a peer group. Returns
    every category ranked worst-to-best by z-score, with the worst top_n
    called out as `weaknesses`. Turnovers are flipped so a HIGH team
    turnover rate always reads as a negative z (a weakness), consistent
    with every other category where negative = below-peer-average = weak.
 
    level: optional -- one of VALID_LEVELS ("High-Major", "Mid-Major", "Low-Major").
    When given, the comparison group is ONLY teams at that tier instead of
    the whole league (the default, and the original behavior). This
    matters for the same reason it mattered for /teams/{id}/fits: a
    Low-Major team's rebounding rate can look "weak" purely because High-
    Major rosters pull the whole-league average up, even if it's average
    for its own level. Pass level=<this team's own tier> to judge
    weaknesses against realistic peers instead of the entire tracked pool.
    """
    profile = get_team_profile(conn, team_id)
    if profile is None:
        raise ProjectionError(f"No team_profile row for team {team_id} -- team may have too "
                               f"thin a roster this season, or the cache needs rebuilding.")
    team = get_team(conn, team_id)

    level = normalize_tier(level)
    n_teams_compared = None
    if level is not None:
        if level not in VALID_LEVELS:
            raise ProjectionError(f"level must be one of {VALID_LEVELS}, got {level!r}.")
        stats_by_cat, n_teams_compared = _level_comparison_stats(conn, level)
        if n_teams_compared == 0:
            raise ProjectionError(f"No teams with tier {level!r} in the current-season cache.")
    else:
        meta = _load_meta(conn)

    # Conference average is always computed alongside whatever the main
    # comparison group is (whole league or a tier) -- a much narrower, more
    # concrete peer group ("how do we stack up against our own conference")
    # that a coach can sanity-check at a glance, shown as an extra reference
    # column rather than replacing the z-score comparison group above.
    conference = team.get("conference") if team else None
    conf_means, n_conf_teams = _conference_comparison_means(conn, conference)

    categories = []
    for stat, info in CATEGORY_INFO.items():
        val = profile.get(stat)
        if val is None:
            continue
        if level is not None:
            cat_stats = stats_by_cat.get(stat)
            if cat_stats is None:
                continue
            mean, std = cat_stats["mean"], cat_stats["std"]
        else:
            mean_key, std_key = f"league_mean_{stat}", f"league_std_{stat}"
            if mean_key not in meta:
                continue
            mean, std = meta[mean_key], meta[std_key]
        z = (val - mean) / std if std else 0.0
        if info["lower_is_better"]:
            z = -z
        conf_mean = conf_means.get(stat)
        # ts_pct/fg_pct are stored in team_profile as raw fractions (0-1),
        # same as everywhere else in the cache -- scale to a percentage for
        # display only (z above is computed from the unscaled fraction, but
        # z is scale-invariant here so this doesn't change it).
        scale = 100.0 if stat in ("ts_pct", "fg_pct") else 1.0
        categories.append(dict(
            # kept as "league_mean" even when level-scoped (not renamed to
            # "peer_mean") so existing callers reading this field don't
            # silently break -- see comparison_group/level on the outer
            # dict for what group this mean was actually computed over.
            stat=stat, label=info["label"],
            team_value=round(val * scale, 3), league_mean=round(mean * scale, 3), z=round(z, 2),
            conference_mean=round(conf_mean * scale, 3) if conf_mean is not None else None,
        ))
    categories.sort(key=lambda c: c["z"])

    return dict(
        team_id=team_id, team_name=team["name"] if team else None,
        roster_size=profile.get("roster_size"),
        level=level, teams_compared=n_teams_compared,
        comparison_group=f"{level} teams only" if level else "whole league",
        conference=conference, teams_in_conference=n_conf_teams,
        weaknesses=categories[:top_n],
        full_profile=categories,
    )
 
 
def find_fits(conn, team_id, stat=None, stats=None, limit=15, min_games=5, transfer_portal_only=False,
              level=None, role=None, minutes=None, class_year=None, position=None):
    """Ranks every player NOT currently on team_id by her PROJECTED
    contribution to one or more stat categories if she transferred to
    team_id -- reusing the exact same _core_projection() math as
    project_player(), so this ranking and a one-off /project call for the
    same player+team always agree.

    stat vs stats: `stat` is the original single-category param (kept for
    backward compatibility) -- if neither `stat` nor `stats` is given,
    auto-picks team_id's single biggest weakness from team_needs() (always
    league-wide, regardless of what `level` is passed here). `stats` is a
    list of category keys for ranking on more than one stat at once (e.g.
    a coach who wants rebounding AND shot-blocking, not just one) -- when
    given, it wins over `stat`.

    Multi-stat ranking method: each candidate's projected value in every
    requested category is converted to a z-score against the whole
    league's mean/std for that category (same numbers team_needs() uses
    for its own whole-league comparison), sign-flipped for categories
    where lower is better (turnovers), then averaged into one composite
    fit_score. Ranking by fit_score for a SINGLE category produces the
    exact same order as the original raw-value sort (z-scoring a single
    category is a monotonic transform), so single-stat callers see
    unchanged behavior; multi-stat is a genuinely new capability. This is
    an average of standardized scores -- a common but still simplified way
    to combine categories that weren't chosen with any particular
    weighting in mind, not a fitted or learned combination.

    role / minutes: same semantics as project_player() -- `minutes` (an
    exact 0-40 number) always wins if given; otherwise `role` (one of
    ROLE_NAMES) is resolved from team_id's OWN current roster via
    team_roles(), same as a real /project call against this team. Neither
    given falls back to each candidate's own auto-projected minutes, same
    as this function's original behavior -- a fit ranking still surveys a
    wide pool by default, but can now be pointed at "if she specifically
    walked into my starting five" instead.

    Every candidate includes current_division ("Level" -- D1/D2/etc, from
    the Teams sheet), current_tier/level ("Level" in the High-Major/Mid-
    Major/Low-Major sense -- the more useful read for "is this realistic,"
    since a top scorer at a High-Major blue-blood will still project well
    statistically at a struggling Low-Major program even though that
    transfer is not realistic), and class_year ("Class"). By default this is a plain
    ranking by projected production, NOT filtered by recruiting realism --
    those fields let a coach eyeball and skip unrealistic candidates by
    hand. Pass `level` to have this function do that filtering itself
    instead.

    level: optional -- one of VALID_LEVELS ("High-Major", "Mid-Major", "Low-Major").
    When given, ONLY players whose CURRENT team is at that tier are
    considered at all -- e.g. level="Low-Major" for a Low-Major team
    excludes every High-Major/Mid-Major player from the candidate pool
    outright, instead of just labeling them and relying on manual
    eyeballing.

    class_year / position: optional exact-match filters on the candidate
    pool (e.g. class_year="FR" for underclassmen only, position="G" for
    guards only) -- useful when a coach only wants to see fits at a
    specific position or eligibility window, not just by statistical need.

    transfer_portal_only: if True, only considers players with
    in_transfer_portal = 1 in the cache. That column comes from an OPTIONAL
    "Transfer Portal" (or "In Transfer Portal") column on the Players
    sheet -- most workbooks won't have one populated yet. If no player in
    the whole cache is flagged, this raises a clear ProjectionError rather
    than silently returning an empty list, so "the portal list isn't
    loaded yet" doesn't get confused with "no one in the portal fits."
    """
    target_team = get_team(conn, team_id)
    if target_team is None:
        raise ProjectionError(f"No team with id {team_id} in the current-season cache.")

    if stats is not None:
        if not stats:
            raise ProjectionError("stats was given but is empty -- pass at least one category, or omit it.")
        stat_keys = list(stats)
    elif stat is not None:
        stat_keys = [stat]
    else:
        needs = team_needs(conn, team_id, top_n=1)
        if not needs["weaknesses"]:
            raise ProjectionError(f"Could not determine a weakness for team {team_id} "
                                   f"(no team_profile categories available).")
        stat_keys = [needs["weaknesses"][0]["stat"]]

    for key in stat_keys:
        if key not in CATEGORY_INFO:
            raise ProjectionError(f"stat/stats entries must be one of {list(CATEGORY_INFO)}, got {key!r}.")
    stat_infos = [dict(stat=key, **CATEGORY_INFO[key]) for key in stat_keys]

    level = normalize_tier(level)
    if level is not None and level not in VALID_LEVELS:
        raise ProjectionError(f"level must be one of {VALID_LEVELS}, got {level!r}.")

    meta = _load_meta(conn)
    teams_by_id = _all_teams_by_id(conn)

    role_info = None
    if role is not None:
        if role not in ROLE_NAMES:
            raise ProjectionError(f"role must be one of {ROLE_NAMES}, got {role!r}.")
        roles = team_roles(conn, team_id)
        role_info = roles[role]

    if transfer_portal_only:
        n_flagged = conn.execute("SELECT COUNT(*) FROM players WHERE in_transfer_portal = 1").fetchone()[0]
        if n_flagged == 0:
            raise ProjectionError(
                "transfer_portal_only=True was requested, but no players in the cache are flagged "
                "in_transfer_portal -- the Players sheet doesn't have transfer portal data loaded yet "
                "(add a 'Transfer Portal' column with Yes/No per player, then rebuild the cache with "
                "build_cache.py). Call this without transfer_portal_only in the meantime."
            )

    cols = [d[0] for d in conn.execute("SELECT * FROM players LIMIT 0").description]
    # Excludes thin_sample candidates (a handful of games / very few
    # minutes this season) -- a fit ranking is meant to surface realistic,
    # well-evidenced transfer targets, and a noisy small-sample projection
    # would just clutter that list. Thin-sample players are still fully
    # findable via /players search and their own profile page (see
    # build_cache.py) -- just not recommended here.
    query = ("SELECT p.* FROM players p JOIN teams t ON p.team_id = t.team_id "
             "WHERE p.team_id != ? AND p.games >= ? AND (p.thin_sample IS NULL OR p.thin_sample = 0)")
    params = [team_id, min_games]
    if transfer_portal_only:
        query += " AND p.in_transfer_portal = 1"
    if level is not None:
        query += " AND t.tier = ?"
        params.append(level)
    if class_year is not None:
        query += " AND p.class_year = ?"
        params.append(class_year)
    if position is not None:
        query += " AND p.position = ?"
        params.append(position)
    candidates = [dict(zip(cols, row)) for row in conn.execute(query, params).fetchall()]

    ranked = []
    for player in candidates:
        current_team = teams_by_id.get(player["team_id"])
        if current_team is None:
            continue  # shouldn't happen in a clean cache; skip defensively
        try:
            result = _core_projection(player, current_team, target_team, meta,
                                       minutes_override=minutes, role=role, role_info=role_info)
        except ProjectionError:
            continue

        projected_stats = {}
        z_scores = []
        missing = False
        for info in stat_infos:
            value = result["projected"].get(info["proj_field"])
            if value is None:
                missing = True
                break
            projected_stats[info["proj_field"]] = value
            mean_key, std_key = f"league_mean_{info['stat']}", f"league_std_{info['stat']}"
            mean, std = meta.get(mean_key), meta.get(std_key)
            z = (value - mean) / std if (mean is not None and std) else 0.0
            if info["lower_is_better"]:
                z = -z
            z_scores.append(z)
        if missing or not z_scores:
            continue
        fit_score = sum(z_scores) / len(z_scores)

        ranked.append(dict(
            player_id=player["player_id"], name=player["name"], position=player["position"],
            class_year=player["class_year"], current_team=current_team["name"],
            current_division=player["division"], current_tier=current_team["tier"],
            level=current_team["tier"],
            in_transfer_portal=player.get("in_transfer_portal"),
            projected=dict(minutes=result["projected"]["minutes"], **projected_stats),
            hoop_score=result["projected"]["hoop_score"],
            confidence=result["confidence"],
            extreme_mismatch=result["extreme_mismatch"],
            fit_score=round(fit_score, 3),
        ))

    ranked.sort(key=lambda r: r["fit_score"], reverse=True)

    single = len(stat_infos) == 1
    return dict(
        team_id=team_id, team_name=target_team["name"],
        # kept for backward compatibility with single-stat callers -- None in multi-stat mode
        stat=stat_infos[0]["stat"] if single else None,
        stat_label=stat_infos[0]["label"] if single else None,
        lower_is_better=stat_infos[0]["lower_is_better"] if single else None,
        stats=[dict(stat=i["stat"], label=i["label"], lower_is_better=i["lower_is_better"]) for i in stat_infos],
        role_applied=dict(role=role, minutes=role_info["minutes"]) if role_info else None,
        minutes_applied=minutes,
        transfer_portal_only=transfer_portal_only,
        level_filter=level,
        candidates=ranked[:limit],
        candidates_considered=len(candidates),
    )
 
 
# ---------- "biggest leap in role" (team profile page) ----------

def leap_candidates(conn, team_id, role=None, minutes=None, limit=8, min_games=5):
    """'Who would make the biggest jump in Summit Score if she transferred
    here and played this role' -- every player NOT on team_id, projected at
    team_id (same role/minutes semantics as project_player/find_fits),
    ranked by the DELTA between her CURRENT Summit Score and her PROJECTED
    Summit Score at this role/team -- not by raw projected value the way
    find_fits ranks stat fits. A high delta means this specific role/team
    combination would be an unusually big statistical step up for her,
    which surfaces different names than "who's already elite" (find_fits'
    default framing).

    To avoid this section freezing on the exact same handful of names every
    time a coach reloads it, the final `limit` candidates are sampled at
    random from the top pool of leap candidates (3x limit, or every
    candidate if fewer) rather than always the strict top N in the same
    order -- still all genuinely high-delta players, just not a frozen
    list. See the response's `note`.
    """
    target_team = get_team(conn, team_id)
    if target_team is None:
        raise ProjectionError(f"No team with id {team_id} in the current-season cache.")
    if role is not None and role not in ROLE_NAMES:
        raise ProjectionError(f"role must be one of {ROLE_NAMES}, got {role!r}.")

    meta = _load_meta(conn)
    teams_by_id = _all_teams_by_id(conn)

    role_info = None
    if role is not None:
        roles = team_roles(conn, team_id)
        role_info = roles[role]

    cols = [d[0] for d in conn.execute("SELECT * FROM players LIMIT 0").description]
    # Same eligibility floor as find_fits (real, well-evidenced seasons only)
    # plus hoop_score_raw IS NOT NULL -- a bare zero-game placeholder row has
    # no current score to compute a meaningful delta from.
    candidates = [
        dict(zip(cols, row)) for row in conn.execute(
            "SELECT p.* FROM players p JOIN teams t ON p.team_id = t.team_id "
            "WHERE p.team_id != ? AND p.games >= ? AND (p.thin_sample IS NULL OR p.thin_sample = 0) "
            "AND p.hoop_score_raw IS NOT NULL",
            (team_id, min_games),
        ).fetchall()
    ]

    ranked = []
    for player in candidates:
        current_team = teams_by_id.get(player["team_id"])
        if current_team is None:
            continue
        try:
            result = _core_projection(player, current_team, target_team, meta,
                                       minutes_override=minutes, role=role, role_info=role_info)
        except ProjectionError:
            continue
        delta = result["projected"]["hoop_score"] - player["hoop_score"]
        ranked.append(dict(
            player_id=player["player_id"], name=player["name"], position=player["position"],
            class_year=player["class_year"], current_team=current_team["name"],
            current_tier=current_team["tier"], level=current_team["tier"],
            current_hoop_score=player["hoop_score"],
            projected_hoop_score=result["projected"]["hoop_score"],
            hoop_score_delta=round(delta, 1),
            projected_minutes=result["projected"]["minutes"],
            confidence=result["confidence"],
        ))

    ranked.sort(key=lambda r: r["hoop_score_delta"], reverse=True)

    # Cap how many candidates from the same originating school can enter the
    # sampling pool. hoop_score_delta is driven purely by the strength-of-
    # schedule gap (see _core_projection) -- it doesn't vary by which player
    # is transferring, only by how much stronger the target team is than her
    # CURRENT team. That means a handful of elite players at a few of the
    # very weakest teams in the country post the largest possible gap/delta
    # against almost any target team, so an uncapped top-delta pool ends up
    # dominated by the same 2-3 schools on every team's page. Capping keeps
    # the ranking itself unchanged (still strictly delta-ordered within what
    # survives the cap) while forcing the pool to represent a wider slice of
    # the country, which is what actually reads as "realistic" to a coach
    # skimming this list.
    MAX_PER_SCHOOL = 2
    per_school_count = defaultdict(int)
    diversified = []
    for r in ranked:
        if per_school_count[r["current_team"]] >= MAX_PER_SCHOOL:
            continue
        diversified.append(r)
        per_school_count[r["current_team"]] += 1

    pool_size = min(len(diversified), max(limit * 3, limit))
    pool = diversified[:pool_size]
    chosen = random.sample(pool, min(limit, len(pool))) if pool else []
    chosen.sort(key=lambda r: r["hoop_score_delta"], reverse=True)

    return dict(
        team_id=team_id, team_name=target_team["name"],
        role_applied=dict(role=role, minutes=role_info["minutes"]) if role_info else None,
        minutes_applied=minutes,
        candidates=chosen,
        candidates_considered=len(candidates),
        note=(
            "Ranked by the jump between each candidate's CURRENT Summit Score and her PROJECTED Summit "
            "Score if she transferred to this team in this role -- not by raw projected value, so this "
            "surfaces the biggest statistical step-ups, not just whoever's already elite. No more than "
            f"{MAX_PER_SCHOOL} candidates from the same current school are allowed into the pool, so this "
            "doesn't turn into the same 2-3 programs' rosters every time. Sampled from the top pool of "
            "leap candidates each time this loads, so refreshing this section can surface a different "
            "(but still genuinely high-leap) mix of names rather than a frozen list."
        ),
    )


# ---------- multi-target roster building ----------
 
def project_batch(conn, target_team_id, requests):
    """requests: [{"player_id": int, "minutes": float|None, "role": str|None}, ...]
    Projects each one at target_team_id (same rules/priority as
    project_player) and adds a simple combined total across all of them --
    useful for "I've got 2 scholarships and these 5 names" instead of
    running /project one at a time and adding it up by hand.
 
    The combined total is a plain sum of individually-projected per-game
    lines. It does NOT re-solve team Off/Def/Rat with these players
    inserted -- that would need re-running the same iterative solver
    build_cache.py uses over a hypothetical roster, which is a bigger,
    separate feature. Treat the combined total as "what these players
    would put up individually in this role mix," not a new team rating.
    """
    target_team = get_team(conn, target_team_id)
    if target_team is None:
        raise ProjectionError(f"No team with id {target_team_id} in the current-season cache.")
 
    results = []
    errors = []
    for req in requests:
        pid = req.get("player_id")
        try:
            r = project_player(conn, pid, target_team_id,
                                minutes_override=req.get("minutes"), role=req.get("role"))
            results.append(r)
        except ProjectionError as exc:
            errors.append(dict(player_id=pid, error=str(exc)))
 
    totals = defaultdict(float)
    total_minutes = 0.0
    for r in results:
        p = r["projected"]
        for field in ("ppg", "rpg", "apg", "bpg", "spg", "topg"):
            if p.get(field) is not None:
                totals[field] += p[field]
        total_minutes += p["minutes"]
 
    combined = dict(
        player_count=len(results),
        total_minutes=round(total_minutes, 1),
        total_minutes_note=(
            "Sum of each player's own projected minutes -- for context, a 5-player rotation "
            "totals 200 team-minutes per game, so this isn't meant to fit inside 40."
        ),
        **{field: round(v, 1) for field, v in totals.items()},
    )
 
    return dict(
        target=dict(team=target_team["name"], division=target_team["division"], tier=target_team["tier"],
                    current_rating=round(target_team["current_rating"], 2)),
        players=results,
        errors=errors,
        combined=combined,
    )
 
 
# ---------- player trajectory ----------
 
# See module docstring -- this threshold is a plain, labeled heuristic
# (average hoop_score_raw change per season), not statistically derived
# from league-wide season-to-season volatility.
TRAJECTORY_IMPROVING_THRESHOLD = 3.0
TRAJECTORY_DECLINING_THRESHOLD = -3.0
 
 
def player_trajectory(conn, player_id):
    """Season-by-season profile from player_history (every season in the
    workbook, not just the current one -- see build_cache.py). Useful for
    telling apart two players with a similar single-season line but very
    different trend: one still climbing, one already past her peak.
    """
    rows = conn.execute(
        """SELECT season, team_id, team_name, games, total_minutes, avg_minutes, ppg, rpg, apg, bpg, spg, topg,
                  ts_pct, fg_pct, per40_pts, per40_reb, per40_ast, hoop_score, hoop_score_raw, thin_sample
           FROM player_history WHERE player_id = ? ORDER BY season""",
        (player_id,),
    ).fetchall()
    if not rows:
        raise ProjectionError(f"No player_history rows for player {player_id} -- unknown to this cache.")
    cols = ["season", "team_id", "team_name", "games", "total_minutes", "avg_minutes", "ppg", "rpg", "apg", "bpg",
            "spg", "topg", "ts_pct", "fg_pct", "per40_pts", "per40_reb", "per40_ast", "hoop_score",
            "hoop_score_raw", "thin_sample"]
    seasons = [dict(zip(cols, row)) for row in rows]
    for s in seasons:
        if s["ts_pct"] is not None:
            s["ts_pct"] = round(s["ts_pct"] * 100, 1)
        if s["fg_pct"] is not None:
            s["fg_pct"] = round(s["fg_pct"] * 100, 1)
        for f in ("avg_minutes", "ppg", "rpg", "apg", "bpg", "spg", "topg", "per40_pts", "per40_reb", "per40_ast"):
            if s[f] is not None:
                s[f] = round(s[f], 1)
 
    name_row = conn.execute("SELECT name FROM player_history WHERE player_id = ? LIMIT 1", (player_id,)).fetchone()
 
    # hoop_score_raw can be None for a season that's a bare placeholder row
    # (on the roster with zero games/no box-score data at all that season --
    # see build_cache.py's third player-inclusion tier) -- exclude those
    # from the trend calc (nothing to compare), but still SHOW them in
    # `seasons` below like every other season on record.
    scored_seasons = [s for s in seasons if s["hoop_score_raw"] is not None]
    if len(scored_seasons) < 2:
        trend, avg_delta = "Insufficient data (fewer than two scored seasons on record)", None
    else:
        first_hs, last_hs = scored_seasons[0]["hoop_score_raw"], scored_seasons[-1]["hoop_score_raw"]
        avg_delta = (last_hs - first_hs) / (len(scored_seasons) - 1)
        if avg_delta >= TRAJECTORY_IMPROVING_THRESHOLD:
            trend = "Improving"
        elif avg_delta <= TRAJECTORY_DECLINING_THRESHOLD:
            trend = "Declining"
        else:
            trend = "Stable"

    for s in seasons:
        if s["hoop_score_raw"] is not None:
            s["hoop_score_raw"] = round(s["hoop_score_raw"], 1)
 
    return dict(
        player_id=player_id, name=name_row[0] if name_row else None,
        seasons=seasons, trend=trend,
        avg_hoop_score_change_per_season=round(avg_delta, 1) if avg_delta is not None else None,
        trend_note="Heuristic based on average Hoop Score change per season on record "
                   f"(>= +{TRAJECTORY_IMPROVING_THRESHOLD} Improving, <= {TRAJECTORY_DECLINING_THRESHOLD} "
                   "Declining, else Stable) -- not a fitted statistical trend.",
    )


# ---------- public leaderboards (Data page) ----------
#
# Both functions below deliberately stay within what the current cache
# schema actually supports: season-aggregate per-player/per-team rows
# (players, team_profile), not per-game logs. That means a genuinely
# useful leaderboard like "High-Major players who perform best specifically
# against other High-Major opponents" is NOT built here -- the cache has no
# opponent-level split (no per-game table with each opponent's tier
# attached), so that would have to be faked from season aggregates. It
# isn't. If/when a per-game PlayerGameStats table with opponent info is
# exposed to the cache, that's a real, separate leaderboard worth adding
# then -- not simulated now. (Update: player_game_logs now exists --
# opponent_split_leaderboard() below is exactly that follow-up leaderboard.)

LEADERBOARD_STATS = {
    "ppg":        dict(label="points per game",            lower_is_better=False),
    "rpg":        dict(label="rebounds per game",           lower_is_better=False),
    "apg":        dict(label="assists per game",            lower_is_better=False),
    "spg":        dict(label="steals per game",             lower_is_better=False),
    "bpg":        dict(label="blocks per game",             lower_is_better=False),
    "topg":       dict(label="turnovers per game",          lower_is_better=True),
    "ts_pct":     dict(label="true shooting %",              lower_is_better=False),
    "fg_pct":     dict(label="field goal %",                 lower_is_better=False),
    "hoop_score": dict(label="Hoop Score",                   lower_is_better=False),
    "per40_pts":  dict(label="points per 40",                lower_is_better=False),
    "per40_reb":  dict(label="rebounds per 40",              lower_is_better=False),
    "per40_ast":  dict(label="assists per 40",               lower_is_better=False),
    "per40_blk":  dict(label="blocks per 40",                lower_is_better=False),
    "per40_stl":  dict(label="steals per 40",                lower_is_better=False),
}


def leaderboard(conn, stat="hoop_score", level=None, division=None, conference=None, min_games=5, limit=25):
    """A straightforward public leaderboard: top (or, for turnovers,
    lowest) players by one real season stat, optionally restricted to one
    tier (level), division (D1/D2), and/or conference. No projection
    involved -- this is what actually happened this season, not a what-if.
    """
    if stat not in LEADERBOARD_STATS:
        raise ProjectionError(f"stat must be one of {list(LEADERBOARD_STATS)}, got {stat!r}.")
    info = LEADERBOARD_STATS[stat]

    level = normalize_tier(level)
    if level is not None and level not in VALID_LEVELS:
        raise ProjectionError(f"level must be one of {VALID_LEVELS}, got {level!r}.")

    # Excludes thin_sample rows (see build_cache.py) -- a public leaderboard
    # shouldn't let a 2-game/12-minute stint's noisy per-game rate outrank a
    # real season. Those players are still fully findable via /players.
    clauses = ["p.games >= ?", "(p.thin_sample IS NULL OR p.thin_sample = 0)"]
    params = [min_games]
    if level is not None:
        clauses.append("t.tier = ?")
        params.append(level)
    if division is not None:
        clauses.append("p.division = ?")
        params.append(division)
    if conference is not None:
        clauses.append("t.conference = ?")
        params.append(conference)
    where = " AND ".join(clauses)
    order = "ASC" if info["lower_is_better"] else "DESC"
    # For hoop_score specifically, sort by hoop_score_raw (unclamped), not
    # hoop_score (the displayed, 30-99-bounded value) -- same reasoning as
    # the fix already applied to /players: several distinct real seasons can
    # legitimately round to the same displayed value near the ceiling, and
    # sorting on that rounded value would tie those players and order them
    # arbitrarily instead of by their real, distinct performance.
    order_col = "p.hoop_score_raw" if stat == "hoop_score" else f"p.{stat}"

    rows = conn.execute(
        f"""SELECT p.player_id, p.name, p.team_id, t.name AS team_name, t.tier, p.division, p.position,
                   p.class_year, p.games, p.ppg, p.rpg, p.apg, p.bpg, p.spg, p.topg, p.ts_pct, p.fg_pct,
                   p.hoop_score, p.{stat} AS stat_value
            FROM players p JOIN teams t ON p.team_id = t.team_id
            WHERE {where} AND p.{stat} IS NOT NULL
            ORDER BY {order_col} {order}
            LIMIT ?""",
        params + [limit],
    ).fetchall()
    result_rows = []
    for r in rows:
        d = dict(r)
        if d.get("ts_pct") is not None:
            d["ts_pct"] = round(d["ts_pct"] * 100, 1)
        if d.get("fg_pct") is not None:
            d["fg_pct"] = round(d["fg_pct"] * 100, 1)
        result_rows.append(d)

    return dict(
        stat=stat, stat_label=info["label"], lower_is_better=info["lower_is_better"],
        level_filter=level, division_filter=division, conference_filter=conference, min_games=min_games,
        players=result_rows,
    )


def standout_projections(conn, level, target_level="High-Major", min_games=8, limit=20):
    """'Who from a lower level projects best at the top level' -- every
    current player at `level` (e.g. Low-Major or Mid-Major), projected
    against a SYNTHETIC team at `target_level` whose current_rating is the
    live average of every real team.tier == target_level team this
    season (not any single school), ranked by projected Hoop Score.
    Reuses the exact same _core_projection() math as /project, with no
    role/minutes override -- same "wide pool survey" default as
    find_fits(). This is explicitly an average-opponent-strength read,
    not a projection at any specific real school -- see
    synthetic_target_rating in the response for the exact number used, so
    it's never confused with a real team's rating.
    """
    level = normalize_tier(level)
    target_level = normalize_tier(target_level)
    if level not in VALID_LEVELS:
        raise ProjectionError(f"level must be one of {VALID_LEVELS}, got {level!r}.")
    if target_level not in VALID_LEVELS:
        raise ProjectionError(f"target_level must be one of {VALID_LEVELS}, got {target_level!r}.")

    target_ratings = [
        row[0] for row in conn.execute(
            "SELECT current_rating FROM teams WHERE tier = ? AND current_rating IS NOT NULL", (target_level,)
        ).fetchall()
    ]
    if not target_ratings:
        raise ProjectionError(f"No teams with tier {target_level!r} in the current-season cache -- "
                               f"can't build a synthetic target.")
    synthetic_rating = statistics.mean(target_ratings)
    synthetic_target = dict(name=f"Average {target_level} team", division="D1", tier=target_level,
                             current_rating=synthetic_rating)

    meta = _load_meta(conn)
    teams_by_id = _all_teams_by_id(conn)

    cols = [d[0] for d in conn.execute("SELECT * FROM players LIMIT 0").description]
    candidates = [
        dict(zip(cols, row)) for row in conn.execute(
            """SELECT p.* FROM players p JOIN teams t ON p.team_id = t.team_id
               WHERE t.tier = ? AND p.games >= ? AND (p.thin_sample IS NULL OR p.thin_sample = 0)""",
            (level, min_games),
        ).fetchall()
    ]

    ranked = []
    for player in candidates:
        current_team = teams_by_id.get(player["team_id"])
        if current_team is None or current_team["tier"] == target_level:
            continue  # already at the target level -- not a "standout from below" case
        try:
            result = _core_projection(player, current_team, synthetic_target, meta)
        except ProjectionError:
            continue
        ranked.append(dict(
            player_id=player["player_id"], name=player["name"], position=player["position"],
            class_year=player["class_year"], current_team=current_team["name"], current_level=level,
            current_hoop_score=player["hoop_score"],
            projected_hoop_score=result["projected"]["hoop_score"],
            projected_ppg=result["projected"]["ppg"],
            projected_minutes=result["projected"]["minutes"],
            confidence=result["confidence"], extreme_mismatch=result["extreme_mismatch"],
        ))

    ranked.sort(key=lambda r: r["projected_hoop_score"], reverse=True)

    return dict(
        level=level, target_level=target_level,
        synthetic_target_rating=round(synthetic_rating, 2),
        synthetic_target_note=(
            f"Projected against a SYNTHETIC average {target_level} team (current_rating "
            f"{round(synthetic_rating, 2)}, the live mean of every real {target_level} team this season), "
            f"not any single real school -- a directional 'who could stand out at that level' read, not a "
            f"projection at a specific program."
        ),
        projected_minutes_note=(
            "projected_minutes is each player's own auto-projected minutes at the synthetic target's "
            "strength (her current minutes, scaled for the level jump) -- no role or target-roster minutes "
            "were applied, since the target here is a synthetic average team, not a real roster with its "
            "own rotation to slot into."
        ),
        players=ranked[:limit],
        candidates_considered=len(candidates),
    )
 
 
# ---------------- opponent-level splits, game logs, schedule ----------------
# Added once player_game_logs/games existed in the cache (per-game rows with
# each game's real opponent_team_id, joined here against teams.tier --
# that's the actual High-Major/Mid-Major/Low-Major level, NOT the sheet's
# "Opponent Division" column, which is just D1/D2 and was never a good
# proxy for level). Previously declined as unsupported ("Not shown here:
# performance splits against a specific opponent tier") because only
# season totals existed; this is the real thing, not an approximation.

OPPONENT_SPLIT_STATS = {
    "points":    dict(label="points per game",     lower_is_better=False),
    "rebounds":  dict(label="rebounds per game",    lower_is_better=False),
    "assists":   dict(label="assists per game",     lower_is_better=False),
    "steals":    dict(label="steals per game",      lower_is_better=False),
    "blocks":    dict(label="blocks per game",      lower_is_better=False),
    "turnovers": dict(label="turnovers per game (lowest)", lower_is_better=True),
}


def opponent_split_leaderboard(conn, own_level=None, opponent_level="High-Major", stat="points",
                                min_games=3, limit=20, season=None, conference=None, top50_only=False,
                                top50_national=False):
    """Real per-game production, filtered to games played against opponents
    at a specific tier -- the "High-Major players who perform best
    specifically against other High-Major opponents" / "Low-Major players
    who perform best against High-Major opponents" leaderboards. own_level
    restricts which players' OWN team tier qualifies (None = any level,
    e.g. for the LM/MM vs HM "who travels well" read); opponent_level is
    required (which tier of opponent these games were against) UNLESS
    top50_national is set (see below). min_games is the minimum number of
    games AGAINST THAT OPPONENT TIER specifically, not season-total games --
    a player might have played 30 games this season but only 4 against
    High-Major competition, and it's the 4-game sample this leaderboard is
    about. `conference` restricts to players whose OWN team is in that
    conference. `top50_only` restricts to games played against one of the
    50 highest-current_rating teams WITHIN opponent_level (not top 50
    nationally) -- e.g. opponent_level=Low-Major, top50_only=True is "games
    against the 50 best Low-Major teams", not every Low-Major team
    including the weakest ones. `top50_national` restricts to games played
    against one of the 50 highest-current_rating teams IN THE COUNTRY,
    regardless of tier -- this is the "how do our own Mid-Major/Low-Major
    players actually perform against genuinely elite competition" read,
    as opposed to top50_only's "best of their own tier" read. When
    top50_national is set, opponent_level is ignored entirely as a filter
    (own_level still applies, to pick which level of PLAYER this list is
    about) -- top50_only and top50_national are mutually exclusive; if
    both are set, top50_national wins.
    """
    own_level = normalize_tier(own_level)
    if stat not in OPPONENT_SPLIT_STATS:
        raise ProjectionError(f"stat must be one of {list(OPPONENT_SPLIT_STATS)}, got {stat!r}.")
    if own_level is not None and own_level not in VALID_LEVELS:
        raise ProjectionError(f"own_level must be one of {VALID_LEVELS}, got {own_level!r}.")
    info = OPPONENT_SPLIT_STATS[stat]

    clauses = []
    params = []
    if top50_national:
        opponent_level = None
        clauses.append(
            "g.opponent_team_id IN (SELECT team_id FROM teams ORDER BY current_rating DESC LIMIT 50)"
        )
    else:
        opponent_level = normalize_tier(opponent_level)
        if opponent_level not in VALID_LEVELS:
            raise ProjectionError(f"opponent_level must be one of {VALID_LEVELS}, got {opponent_level!r}.")
        clauses.append("opp_t.tier = ?")
        params.append(opponent_level)
        if top50_only:
            clauses.append(
                "g.opponent_team_id IN (SELECT team_id FROM teams WHERE tier = ? "
                "ORDER BY current_rating DESC LIMIT 50)"
            )
            params.append(opponent_level)
    if own_level is not None:
        clauses.append("own_t.tier = ?")
        params.append(own_level)
    if conference is not None:
        clauses.append("own_t.conference = ?")
        params.append(conference)
    if season is not None:
        clauses.append("g.season = ?")
        params.append(season)
    else:
        # Default to the cache's current season -- otherwise a player's
        # rows from 3 seasons of history would all blend together.
        current_season = _load_meta(conn)["season"]
        clauses.append("g.season = ?")
        params.append(current_season)
    where = " AND ".join(clauses)
    order = "ASC" if info["lower_is_better"] else "DESC"

    rows = conn.execute(
        f"""SELECT p.player_id, p.name, own_t.name AS team_name, own_t.tier AS own_tier,
                   p.position, p.class_year,
                   COUNT(*) AS games_vs_opponent,
                   AVG(g.points) AS avg_points, AVG(g.rebounds) AS avg_rebounds,
                   AVG(g.assists) AS avg_assists, AVG(g.steals) AS avg_steals,
                   AVG(g.blocks) AS avg_blocks, AVG(g.turnovers) AS avg_turnovers,
                   AVG(g.{stat}) AS stat_value
            FROM player_game_logs g
            JOIN players p ON g.player_id = p.player_id
            JOIN teams own_t ON g.team_id = own_t.team_id
            JOIN teams opp_t ON g.opponent_team_id = opp_t.team_id
            WHERE {where}
            GROUP BY g.player_id
            HAVING games_vs_opponent >= ?
            ORDER BY stat_value {order}
            LIMIT ?""",
        params + [min_games, limit],
    ).fetchall()

    players = [dict(
        player_id=r["player_id"], name=r["name"], team_name=r["team_name"], own_tier=r["own_tier"],
        position=r["position"], class_year=r["class_year"], games_vs_opponent=r["games_vs_opponent"],
        avg_points=round(r["avg_points"], 1), avg_rebounds=round(r["avg_rebounds"], 1),
        avg_assists=round(r["avg_assists"], 1), avg_steals=round(r["avg_steals"], 1),
        avg_blocks=round(r["avg_blocks"], 1), avg_turnovers=round(r["avg_turnovers"], 1),
        stat_value=round(r["stat_value"], 1),
    ) for r in rows]

    return dict(
        stat=stat, stat_label=info["label"], lower_is_better=info["lower_is_better"],
        own_level=own_level, opponent_level=opponent_level, min_games=min_games,
        conference_filter=conference, top50_only=top50_only, top50_national=top50_national,
        players=players,
    )


def player_game_logs(conn, player_id, season=None):
    """Every individual game this player appeared in (optionally filtered
    to one season), most recent first -- powers the expandable per-season
    game log on the player profile page. opponent_tier is resolved here via
    a join against teams.tier (opponent_team_id may be NULL for a small
    fraction of games -- an untracked/D2 opponent not in the teams table --
    in which case opponent_tier comes back None rather than guessed)."""
    clauses = ["g.player_id = ?"]
    params = [player_id]
    if season is not None:
        clauses.append("g.season = ?")
        params.append(season)
    where = " AND ".join(clauses)

    rows = conn.execute(
        f"""SELECT g.season, g.date, g.opponent_name, opp_t.tier AS opponent_tier,
                   g.started, g.minutes, g.points, g.rebounds, g.assists, g.steals, g.blocks,
                   g.turnovers, g.fouls, g.fgm, g.fga, g.tfgm, g.tfga, g.ftm, g.fta
            FROM player_game_logs g
            LEFT JOIN teams opp_t ON g.opponent_team_id = opp_t.team_id
            WHERE {where}
            ORDER BY g.date DESC""",
        params,
    ).fetchall()
    return dict(player_id=player_id, season=season, games=[dict(r) for r in rows])


def team_schedule(conn, team_id, season=None):
    """This team's full schedule/results (optionally filtered to one
    season), most recent first -- powers the team profile's Schedule tab."""
    clauses = ["(home_team_id = ? OR away_team_id = ?)"]
    params = [team_id, team_id]
    if season is not None:
        clauses.append("season = ?")
        params.append(season)
    where = " AND ".join(clauses)

    rows = conn.execute(
        f"""SELECT game_id, season, date, home_team_id, home_team_name, away_team_id, away_team_name,
                   home_score, away_score, winner_team_id, margin, neutral_site, overtime, conference_game
            FROM games WHERE {where} ORDER BY date DESC""",
        params,
    ).fetchall()

    games = []
    for r in rows:
        d = dict(r)
        is_home = d["home_team_id"] == team_id
        d["opponent_name"] = d["away_team_name"] if is_home else d["home_team_name"]
        d["opponent_team_id"] = d["away_team_id"] if is_home else d["home_team_id"]
        d["team_score"] = d["home_score"] if is_home else d["away_score"]
        d["opponent_score"] = d["away_score"] if is_home else d["home_score"]
        d["is_home"] = is_home
        d["won"] = (d["winner_team_id"] == team_id) if d["winner_team_id"] is not None else None
        games.append(d)

    return dict(team_id=team_id, season=season, games=games)


def player_splits(conn, player_id, season=None):
    """Four ways to slice this player's game log for her profile page,
    beyond a single season-long average: performance against each
    opponent tier (High-Major/Mid-Major/Low-Major), against the 50
    highest-current_rating teams in the country regardless of tier, and
    across just her most recent 10 games. Built from the same real
    per-game rows as /players/{id}/game-logs and /leaderboards/opponent-
    splits, just grouped differently -- no projection involved.
    """
    player = get_player(conn, player_id)
    if player is None:
        raise ProjectionError(f"No player with id {player_id} in the current-season cache.")
    season = season or _load_meta(conn)["season"]

    def _avg_row(rows):
        n = len(rows)
        if n == 0:
            return None

        def avg(key):
            return round(sum(r[key] for r in rows) / n, 1)

        return dict(
            games=n, avg_points=avg("points"), avg_rebounds=avg("rebounds"),
            avg_assists=avg("assists"), avg_steals=avg("steals"), avg_blocks=avg("blocks"),
            avg_turnovers=avg("turnovers"), avg_minutes=avg("minutes"),
        )

    rows = conn.execute(
        """SELECT g.game_id, g.date, g.opponent_team_id, g.opponent_name, opp_t.tier AS opponent_tier,
                  opp_t.current_rating AS opponent_rating,
                  g.minutes, g.points, g.rebounds, g.assists, g.steals, g.blocks, g.turnovers
           FROM player_game_logs g
           LEFT JOIN teams opp_t ON g.opponent_team_id = opp_t.team_id
           WHERE g.player_id = ? AND g.season = ?
           ORDER BY g.date DESC""",
        (player_id, season),
    ).fetchall()
    all_games = [dict(r) for r in rows]

    by_tier = {tier: _avg_row([g for g in all_games if g["opponent_tier"] == tier]) for tier in VALID_LEVELS}

    top50_ids = {
        row[0] for row in conn.execute(
            "SELECT team_id FROM teams WHERE current_rating IS NOT NULL ORDER BY current_rating DESC LIMIT 50"
        ).fetchall()
    }
    top50_games = [g for g in all_games if g["opponent_team_id"] in top50_ids]
    last10_games = all_games[:10]  # already most-recent-first

    return dict(
        player_id=player_id, name=player["name"], season=season, total_games=len(all_games),
        by_opponent_tier=by_tier,
        vs_top50=_avg_row(top50_games),
        vs_top50_note="Games against any of the 50 highest-rated teams in the country this season "
                       "(by current_rating), regardless of tier -- not a top-50-per-tier cut.",
        last10=_avg_row(last10_games),
        last10_games=[
            dict(date=g["date"], opponent_name=g["opponent_name"], opponent_tier=g["opponent_tier"],
                 points=g["points"], rebounds=g["rebounds"], assists=g["assists"])
            for g in last10_games
        ],
    )


BACK_HALF_SORT_FIELDS = {
    "ppg": "ppg_change",
    "rpg": "rpg_change",
    "apg": "apg_change",
    "ts": "ts_pct_change",
    "mpg": "mpg_change",
    "topg": "topg_change",
}

# turnovers: a DECREASE (negative change) is the improvement, same
# lower_is_better convention used for turnovers everywhere else on the site
# (CATEGORY_INFO, opponent-split leaderboards). Every other sort field here
# treats a positive change as the improvement.
BACK_HALF_LOWER_IS_BETTER = {"topg"}


def back_half_leaderboard(conn, level=None, min_games_per_half=5, min_games=15, min_mpg=10.0,
                           limit=20, season=None, sort="ppg"):
    """'Best back half of the season' -- ranks current-season players by
    how much a given stat changed from the first half of THEIR OWN games
    played to the second half (split at the midpoint of her own games, not
    the calendar midpoint of the season, so a player who missed early
    games due to injury is still compared fairly on her own two halves).
    A positive change means she's been trending up; negative means down
    (except `topg`, see BACK_HALF_LOWER_IS_BETTER above). No projection
    involved -- this is real per-game production, just split in two and
    compared.

    `sort` picks which stat's change ranks the returned list -- "ppg"
    (default), "rpg", "apg", "ts" (true shooting %), "mpg" (minutes per
    game -- whose role is trending up/down), "topg" (turnovers per game --
    ranked by biggest DECREASE first, i.e. "who tightened up her ball
    security the most"), or "all". Pass "all" to get all 6 rankings in ONE
    call (see `by_sort` on the return value) -- this re-sorts the same
    already-computed per-player rows 6 ways in plain Python, so it costs
    one DB scan/aggregation instead of 6. A caller that used to call this
    endpoint once per stat (multiple round trips) should switch to one
    `sort=all` call instead -- separate calls each re-run the same
    expensive full-season `player_game_logs` scan and per-player
    aggregation from scratch, which is what made the Data page's back-half
    section slow enough to time out in production after a 4-calls-per-
    page-load pattern shipped in an earlier pass. All `first_half_*`/
    `second_half_*`/`*_change` fields are always present on every row
    regardless of which stat is driving a given ranking.

    `min_games` (default 15) is the minimum TOTAL games played this season
    (both halves combined) -- a stricter floor than `min_games_per_half`
    alone (default 5, i.e. as few as 10 total) to keep this leaderboard
    limited to players with a real, meaningfully-sized role, not a deep
    reserve who barely played. `min_mpg` (default 10.0) is the minimum
    season-average minutes per game, same reasoning -- someone playing 3
    minutes a game can post a huge PERCENTAGE swing in a stat from pure
    noise. Both floors apply in addition to `min_games_per_half`.
    """
    level = normalize_tier(level)
    if level is not None and level not in VALID_LEVELS:
        raise ProjectionError(f"level must be one of {VALID_LEVELS}, got {level!r}.")
    if sort != "all" and sort not in BACK_HALF_SORT_FIELDS:
        raise ProjectionError(f"sort must be one of {list(BACK_HALF_SORT_FIELDS) + ['all']}, got {sort!r}.")
    season = season or _load_meta(conn)["season"]

    clauses = ["g.season = ?"]
    params = [season]
    if level is not None:
        clauses.append("t.tier = ?")
        params.append(level)
    where = " AND ".join(clauses)

    rows = conn.execute(
        f"""SELECT g.player_id, p.name, t.team_id, t.name AS team_name, t.tier, g.date,
                   g.points, g.rebounds, g.assists, g.fgm, g.fga, g.ftm, g.fta, g.minutes, g.turnovers
            FROM player_game_logs g
            JOIN players p ON g.player_id = p.player_id
            JOIN teams t ON g.team_id = t.team_id
            WHERE {where}
            ORDER BY g.player_id, g.date ASC""",
        params,
    ).fetchall()

    by_player = defaultdict(list)
    meta_by_player = {}
    for r in rows:
        by_player[r["player_id"]].append(r)
        meta_by_player[r["player_id"]] = (r["name"], r["team_id"], r["team_name"], r["tier"])

    # True-shooting floor for a HALF-season sample is deliberately lower than
    # the 15-attempt season floor used elsewhere (build_cache.py) -- a half
    # is already a smaller slice by definition, and requiring 15 attempts
    # per half would blank out efficiency for most otherwise-qualifying
    # players. 8 still screens out the most extreme small-sample noise.
    HALF_TS_ATTEMPT_FLOOR = 8

    def _half_stats(games):
        n = len(games)
        pts = sum(g["points"] for g in games)
        reb = sum(g["rebounds"] for g in games)
        ast = sum(g["assists"] for g in games)
        fga = sum(g["fga"] for g in games)
        fta = sum(g["fta"] for g in games)
        mins = sum(g["minutes"] for g in games)
        tov = sum(g["turnovers"] for g in games)
        tsa = fga + 0.44 * fta
        ts_pct = (pts / (2 * tsa)) if tsa >= HALF_TS_ATTEMPT_FLOOR else None
        return dict(ppg=pts / n, rpg=reb / n, apg=ast / n, ts_pct=ts_pct, mpg=mins / n, topg=tov / n)

    results = []
    for pid, glist in by_player.items():
        n = len(glist)
        if n < min_games:
            continue
        season_mpg = sum(g["minutes"] for g in glist) / n
        if season_mpg < min_mpg:
            continue
        half = n // 2
        first, second = glist[:half], glist[half:]
        if len(first) < min_games_per_half or len(second) < min_games_per_half:
            continue
        fs, ss = _half_stats(first), _half_stats(second)
        name, team_id, team_name, tier = meta_by_player[pid]
        both_ts = fs["ts_pct"] is not None and ss["ts_pct"] is not None
        results.append(dict(
            player_id=pid, name=name, team_id=team_id, team_name=team_name, tier=tier,
            first_half_games=len(first), second_half_games=len(second),
            first_half_ppg=round(fs["ppg"], 1), second_half_ppg=round(ss["ppg"], 1),
            ppg_change=round(ss["ppg"] - fs["ppg"], 1),
            first_half_rpg=round(fs["rpg"], 1), second_half_rpg=round(ss["rpg"], 1),
            rpg_change=round(ss["rpg"] - fs["rpg"], 1),
            first_half_apg=round(fs["apg"], 1), second_half_apg=round(ss["apg"], 1),
            apg_change=round(ss["apg"] - fs["apg"], 1),
            first_half_ts_pct=round(fs["ts_pct"] * 100, 1) if fs["ts_pct"] is not None else None,
            second_half_ts_pct=round(ss["ts_pct"] * 100, 1) if ss["ts_pct"] is not None else None,
            ts_pct_change=round((ss["ts_pct"] - fs["ts_pct"]) * 100, 1) if both_ts else None,
            first_half_mpg=round(fs["mpg"], 1), second_half_mpg=round(ss["mpg"], 1),
            mpg_change=round(ss["mpg"] - fs["mpg"], 1),
            first_half_topg=round(fs["topg"], 1), second_half_topg=round(ss["topg"], 1),
            topg_change=round(ss["topg"] - fs["topg"], 1),
        ))

    common_note = (
        "Each player's own games are split at the midpoint of HER games played this season (not the "
        "calendar midpoint). A missed-games injury early in the year doesn't skew this the way splitting "
        "by calendar date would. First/second-half PPG, RPG, APG, TS%, MPG, and TOPG are all shown on "
        f"every row for context regardless of which stat is driving a given ranking. TS% needs at least "
        f"{HALF_TS_ATTEMPT_FLOOR} true-shot attempts in a half to compute -- null otherwise, and those "
        f"players are excluded when ranking by TS% change specifically. Limited to players with at least "
        f"{min_games} games and {min_mpg:g} minutes per game this season, so this reflects real rotation "
        f"players, not small-sample noise from someone who barely played."
    )

    def _ranked(sort_key):
        field = BACK_HALF_SORT_FIELDS[sort_key]
        rows = results
        if sort_key == "ts":
            rows = [r for r in rows if r[field] is not None]
        reverse = sort_key not in BACK_HALF_LOWER_IS_BETTER
        return sorted(rows, key=lambda r: r[field], reverse=reverse)[:limit]

    if sort == "all":
        return dict(
            level_filter=level, season=season, min_games_per_half=min_games_per_half,
            min_games=min_games, min_mpg=min_mpg, sort="all",
            note=f"{common_note} This response has one independently-ranked list per stat (`by_sort.ppg`, "
                 f".rpg, .apg, .ts, .mpg, .topg) -- each is a genuinely distinct ranking, not the same "
                 f"players relabeled. `by_sort.topg` is ranked by the biggest DECREASE in turnovers first "
                 f"(improved ball security), not the biggest increase.",
            by_sort=dict(
                ppg=_ranked("ppg"), rpg=_ranked("rpg"), apg=_ranked("apg"), ts=_ranked("ts"),
                mpg=_ranked("mpg"), topg=_ranked("topg"),
            ),
        )

    stat_label = {
        "ppg": "points", "rpg": "rebounds", "apg": "assists", "ts": "true shooting %",
        "mpg": "minutes played", "topg": "turnovers (biggest decrease first)",
    }[sort]
    return dict(
        level_filter=level, season=season, min_games_per_half=min_games_per_half,
        min_games=min_games, min_mpg=min_mpg, sort=sort,
        note=f"{common_note} This list is ranked by {stat_label} change from her first half to her second half.",
        players=_ranked(sort),
    )


def conference_standings(conn, conference, season=None):
    """Win/loss records for every team in one conference this season, both
    overall and conference-only (using the Games sheet's own
    conference_game flag), sorted by conference win percentage then wins.
    """
    season = season or _load_meta(conn)["season"]
    teams = conn.execute(
        "SELECT team_id, name, current_rating FROM teams WHERE conference = ?", (conference,)
    ).fetchall()
    if not teams:
        raise ProjectionError(f"No teams found in conference {conference!r} in the current cache.")
    team_ids = {t["team_id"] for t in teams}
    team_name = {t["team_id"]: t["name"] for t in teams}
    rating = {t["team_id"]: t["current_rating"] for t in teams}

    all_games = conn.execute(
        "SELECT home_team_id, away_team_id, winner_team_id, conference_game FROM games WHERE season = ?",
        (season,),
    ).fetchall()

    record = {tid: dict(wins=0, losses=0, conf_wins=0, conf_losses=0) for tid in team_ids}
    for g in all_games:
        home, away, winner, conf_game = g["home_team_id"], g["away_team_id"], g["winner_team_id"], g["conference_game"]
        if winner is None:
            continue
        for tid in (home, away):
            if tid not in team_ids:
                continue
            won = winner == tid
            record[tid]["wins" if won else "losses"] += 1
            if conf_game:
                record[tid]["conf_wins" if won else "conf_losses"] += 1

    standings = []
    for tid in team_ids:
        r = record[tid]
        conf_gp = r["conf_wins"] + r["conf_losses"]
        standings.append(dict(
            team_id=tid, name=team_name[tid], current_rating=rating[tid],
            wins=r["wins"], losses=r["losses"],
            conference_wins=r["conf_wins"], conference_losses=r["conf_losses"],
            conference_win_pct=round(r["conf_wins"] / conf_gp, 3) if conf_gp else None,
        ))
    standings.sort(key=lambda s: (-(s["conference_win_pct"] if s["conference_win_pct"] is not None else -1),
                                   -s["wins"]))
    return dict(conference=conference, season=season, teams=standings)


def game_detail(conn, game_id):
    """Full box score for one game -- both teams' complete per-player
    lines, plus the game's own metadata (date, score, home/away,
    overtime/neutral-site flags). Powers a game detail page linked from a
    team's Schedule tab."""
    g = conn.execute(
        """SELECT game_id, season, date, home_team_id, home_team_name, away_team_id, away_team_name,
                  home_score, away_score, winner_team_id, margin, neutral_site, overtime, conference_game
           FROM games WHERE game_id = ?""",
        (game_id,),
    ).fetchone()
    if g is None:
        raise ProjectionError(f"No game with id {game_id} in the current cache.")
    g = dict(g)

    box_rows = conn.execute(
        """SELECT gl.player_id, p.name, gl.team_id, gl.started, gl.minutes, gl.points, gl.rebounds,
                  gl.assists, gl.steals, gl.blocks, gl.turnovers, gl.fouls, gl.fgm, gl.fga, gl.tfgm, gl.tfga,
                  gl.ftm, gl.fta
           FROM player_game_logs gl JOIN players p ON gl.player_id = p.player_id
           WHERE gl.game_id = ?
           ORDER BY gl.points DESC""",
        (game_id,),
    ).fetchall()
    box_rows = [dict(r) for r in box_rows]
    home_box = [r for r in box_rows if r["team_id"] == g["home_team_id"]]
    away_box = [r for r in box_rows if r["team_id"] == g["away_team_id"]]

    return dict(g, home_box_score=home_box, away_box_score=away_box)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CLI smoke test for project_player")
    parser.add_argument("--db", default="summit_tpe_cache.sqlite")
    parser.add_argument("--player-id", type=int, default=None)
    parser.add_argument("--target-team-id", type=int, default=None)
    parser.add_argument("--minutes", type=float, default=None)
    parser.add_argument("--role", choices=ROLE_NAMES, default=None)
    parser.add_argument("--show-roles", action="store_true", help="Just print the target team's role minutes and exit")
    parser.add_argument("--needs", action="store_true", help="Print --target-team-id's biggest statistical weaknesses")
    parser.add_argument("--fits", action="store_true", help="Print top fits for --target-team-id (auto-picks the biggest weakness unless --stat is given)")
    parser.add_argument("--stat", default=None)
    parser.add_argument("--trajectory", action="store_true", help="Print --player-id's season-by-season trajectory")
    args = parser.parse_args()
    conn = sqlite3.connect(args.db)
    import json
    if args.show_roles:
        print(json.dumps(team_roles(conn, args.target_team_id), indent=2))
    elif args.needs:
        print(json.dumps(team_needs(conn, args.target_team_id), indent=2))
    elif args.fits:
        print(json.dumps(find_fits(conn, args.target_team_id, stat=args.stat), indent=2))
    elif args.trajectory:
        print(json.dumps(player_trajectory(conn, args.player_id), indent=2))
    else:
        print(json.dumps(
            project_player(conn, args.player_id, args.target_team_id, args.minutes, args.role), indent=2
        ))