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
"""

import sqlite3

from summit_calc import clamp

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


def _load_meta(conn):
    rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    return dict(season=rows["season"], league_mean_rat=float(rows["league_mean_rat"]),
                league_std_rat=float(rows["league_std_rat"]))


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
        raise ProjectionError(f"No player with id {player_id} in the current-season cache "
                               f"(either unknown, or she didn't meet the minimum-games threshold).")
    target_team = get_team(conn, target_team_id)
    if target_team is None:
        raise ProjectionError(f"No team with id {target_team_id} in the current-season cache.")
    current_team = get_team(conn, player["team_id"])
    if current_team is None:
        raise ProjectionError(f"Player's current team (id {player['team_id']}) isn't in the "
                               f"current-season cache -- can't compute a strength gap.")

    meta = _load_meta(conn)
    std = meta["league_std_rat"]

    strength_gap = target_team["current_rating"] - current_team["current_rating"]
    gap_std = strength_gap / std if std else 0.0

    production_factor = clamp(
        PRODUCTION_FACTOR_INTERCEPT - strength_gap / (PRODUCTION_FACTOR_DENOM_STD * std), *PRODUCTION_FACTOR_BOUNDS
    )
    minutes_factor = clamp(1.0 - strength_gap / (MINUTES_FACTOR_DENOM_STD * std), *MINUTES_FACTOR_BOUNDS)
    hoopscore_shift = clamp(-strength_gap / (HOOPSCORE_DENOM_STD * std), *HOOPSCORE_SHIFT_BOUNDS)

    minutes_source = "auto_projected"
    role_info = None
    if minutes_override is not None:
        if minutes_override < 0 or minutes_override > 40:
            raise ProjectionError("minutes_override must be between 0 and 40.")
        proj_minutes = minutes_override
        minutes_source = "coach_override"
    elif role is not None:
        if role not in ROLE_NAMES:
            raise ProjectionError(f"role must be one of {ROLE_NAMES}, got {role!r}.")
        roles = team_roles(conn, target_team_id)
        role_info = roles[role]
        if role_info.get("minutes") is None:
            raise ProjectionError(
                f"Can't resolve role '{role}' for {target_team['name']} -- not enough rotation "
                f"players on record for that team this season to compute it. Use minutes_override instead."
            )
        proj_minutes = role_info["minutes"]
        minutes_source = f"role:{role}"
    else:
        proj_minutes = clamp(player["avg_minutes"] * minutes_factor, 4.0, 36.0)

    proj_per40_pts = player["per40_pts"] * production_factor
    proj_per40_reb = player["per40_reb"] * production_factor
    proj_per40_ast = player["per40_ast"] * production_factor
    # Blocks/steals are "production" stats like points/rebounds -- weaker
    # competition means more/easier opportunities to generate them, so they
    # scale the same direction as production_factor.
    proj_per40_blk = player["per40_blk"] * production_factor if player["per40_blk"] is not None else None
    proj_per40_stl = player["per40_stl"] * production_factor if player["per40_stl"] is not None else None
    # Turnovers move the OPPOSITE direction from everything else: a tougher,
    # longer, faster defense forces more turnovers, not fewer, so this is
    # deliberately NOT multiplied by production_factor directly. Mirroring
    # production_factor around the fitted intercept (rather than a flat 1.0)
    # keeps it centered on the same real-data baseline as everything else,
    # while still pointing the right way: a much stronger target team pushes
    # turnovers up, a much weaker one pulls them down.
    tov_factor = 2.0 * PRODUCTION_FACTOR_INTERCEPT - production_factor
    proj_per40_tov = player["per40_tov"] * tov_factor if player["per40_tov"] is not None else None

    proj_ppg = proj_per40_pts * proj_minutes / 40.0
    proj_rpg = proj_per40_reb * proj_minutes / 40.0
    proj_apg = proj_per40_ast * proj_minutes / 40.0
    proj_bpg = proj_per40_blk * proj_minutes / 40.0 if proj_per40_blk is not None else None
    proj_spg = proj_per40_stl * proj_minutes / 40.0 if proj_per40_stl is not None else None
    proj_topg = proj_per40_tov * proj_minutes / 40.0 if proj_per40_tov is not None else None
    proj_ts = clamp(player["ts_pct"] * production_factor, *TS_BOUNDS) if player["ts_pct"] is not None else None
    proj_fg = clamp(player["fg_pct"] * production_factor, *TS_BOUNDS) if player["fg_pct"] is not None else None

    proj_hoop_score = round(clamp(player["hoop_score_raw"] + hoopscore_shift, 30.0, 99.0), 1)

    is_underclass = player["class_year"] in UNDERCLASS_YEARS
    mismatch_threshold = EXTREME_MISMATCH_STD_UNDERCLASS if is_underclass else EXTREME_MISMATCH_STD
    extreme_mismatch = abs(gap_std) >= mismatch_threshold

    confidence = "High" if player["games"] >= 20 else ("Medium" if player["games"] >= 10 else "Low")
    tiers = ["Low", "Medium", "High"]
    if is_underclass:
        # A freshman/sophomore season is a smaller, noisier sample of a
        # still-developing player -- one confidence tier lower than the
        # same games/production would earn an upperclassman.
        confidence = tiers[max(0, tiers.index(confidence) - 1)]
    if extreme_mismatch and confidence == "High":
        # Even a well-sampled upperclassman season doesn't make an extreme
        # strength-gap projection more certain -- that uncertainty comes
        # from the size of the jump, not the size of her sample.
        confidence = "Medium"

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
            minutes=round(proj_minutes, 1), ppg=round(proj_ppg, 1), rpg=round(proj_rpg, 1),
            apg=round(proj_apg, 1), bpg=round(proj_bpg, 1) if proj_bpg is not None else None,
            spg=round(proj_spg, 1) if proj_spg is not None else None,
            topg=round(proj_topg, 1) if proj_topg is not None else None,
            ts_pct=round(proj_ts * 100, 1) if proj_ts is not None else None,
            fg_pct=round(proj_fg * 100, 1) if proj_fg is not None else None,
            hoop_score=proj_hoop_score,
        ),
        confidence=confidence,
        strength_gap=round(strength_gap, 2),
        gap_std=round(gap_std, 2),
        extreme_mismatch=extreme_mismatch,
    )
    if extreme_mismatch:
        result["extreme_mismatch_note"] = (
            "Extreme mismatch — projection may be conservative. This target represents an unusually "
            "large strength gap for this player (%.1f standard deviations); treat the exact numbers as "
            "a reasoned estimate, not a precise forecast." % gap_std
        )
    if role is not None:
        result["role_applied"] = dict(role=role, **role_info)
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CLI smoke test for project_player")
    parser.add_argument("--db", default="summit_tpe_cache.sqlite")
    parser.add_argument("--player-id", type=int, required=True)
    parser.add_argument("--target-team-id", type=int, required=True)
    parser.add_argument("--minutes", type=float, default=None)
    parser.add_argument("--role", choices=ROLE_NAMES, default=None)
    parser.add_argument("--show-roles", action="store_true", help="Just print the target team's role minutes and exit")
    args = parser.parse_args()
    conn = sqlite3.connect(args.db)
    import json
    if args.show_roles:
        print(json.dumps(team_roles(conn, args.target_team_id), indent=2))
    else:
        print(json.dumps(
            project_player(conn, args.player_id, args.target_team_id, args.minutes, args.role), indent=2
        ))
