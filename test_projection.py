"""Regression tests for projection.py, run against a fixed synthetic cache
built directly in this file (not build_cache.py's output) so every number
is fully controlled and hand-verifiable.
 
Two kinds of tests here, deliberately:
 
1. GOLDEN VALUE tests -- a couple of cases where the target team's rating
   is chosen so gap_std lands EXACTLY on a TRANSFER_SPREAD_TABLE bucket
   center (no interpolation involved), so the expected output can be
   computed by hand from the documented formulas in projection.py's module
   docstring and frozen here. These catch any accidental change to the
   calibration constants or the core formula.
 
2. INVARIANT / PROPERTY tests -- things that must ALWAYS hold regardless
   of the exact calibration numbers, chosen specifically to re-check bug
   classes already caught by hand in this project:
     - the turnover-range inversion bug (topg moves OPPOSITE production_
       factor, so a naive range calculation can silently flip it -- see
       test_projected_range_always_brackets_point_estimate and
       test_topg_direction_vs_other_stats)
     - the fits/needs "realistic candidate" filtering added later (level,
       transfer_portal_only) actually filters, not just labels
 
Run:
    pip install pytest --break-system-packages   # if not already installed
    pytest test_projection.py -v
"""
 
import sqlite3
 
import pytest
 
from projection import (
    CATEGORY_INFO, ProjectionError, find_fits, player_trajectory, project_batch,
    project_player, team_needs,
)
 
SEASON = "2025-26"
 
# team_id -> (name, tier, current_rating). std is fixed at 10.0 in meta
# below, so these ratings were chosen to land gap_std on exact
# TRANSFER_SPREAD_TABLE bucket centers for the golden tests.
TEAMS = {
    1: ("P5 Team", "P5", 10.0),
    2: ("Mid Team", "Mid-Major", 0.0),
    3: ("Low Team A", "Low-Major", -10.0),
    4: ("Low Team B", "Low-Major", -15.0),
}
 
# Whole-league reference (meta table) -- set directly/independently of the
# team_profile rows below, so whole-league z-scores are fully controlled
# rather than derived (real build_cache.py DOES derive them from every
# team; controlling them directly here just makes the golden numbers
# hand-verifiable without also having to hand-average 4 teams).
LEAGUE_META_STATS = {
    "per40_pts": (16.0, 3.0), "per40_reb": (30.0, 3.0), "per40_ast": (15.0, 4.0),
    "per40_blk": (2.5, 1.0), "per40_stl": (5.5, 1.0), "per40_tov": (11.0, 2.0),
    "ts_pct": (0.48, 0.05), "fg_pct": (0.41, 0.04),
}
 
# team_profile rows. T3 vs T4's per40_ast/per40_tov are deliberately set so
# T3 reads as weak-ish league-wide but ABOVE its Low-Major peers -- the
# exact distortion the level filter exists to correct (see
# test_needs_level_filter_changes_the_verdict).
TEAM_PROFILE = {
    1: dict(roster_size=12, per40_pts=22.0, per40_reb=34.0, per40_ast=20.0, per40_blk=3.5,
            per40_stl=6.5, per40_tov=11.0, ts_pct=0.52, fg_pct=0.43),
    2: dict(roster_size=12, per40_pts=17.0, per40_reb=31.0, per40_ast=15.0, per40_blk=2.8,
            per40_stl=5.8, per40_tov=12.0, ts_pct=0.49, fg_pct=0.41),
    3: dict(roster_size=12, per40_pts=14.0, per40_reb=29.0, per40_ast=13.0, per40_blk=2.2,
            per40_stl=5.2, per40_tov=13.0, ts_pct=0.46, fg_pct=0.39),
    4: dict(roster_size=12, per40_pts=13.0, per40_reb=28.0, per40_ast=11.0, per40_blk=2.0,
            per40_stl=5.0, per40_tov=11.0, ts_pct=0.45, fg_pct=0.38),
}
 
PLAYERS = [
    # player_id, name, team_id, class_year, games, avg_minutes,
    # ppg,rpg,apg,bpg,spg,topg, ts_pct,fg_pct,
    # per40_pts,per40_reb,per40_ast,per40_blk,per40_stl,per40_tov,
    # hoop_score, hoop_score_raw, in_transfer_portal
    dict(player_id=201, name="Test Player", team_id=2, class_year="JR", games=20, avg_minutes=25.0,
         ppg=20.0, rpg=8.0, apg=4.0, bpg=1.0, spg=1.5, topg=3.0, ts_pct=0.55, fg_pct=0.45,
         per40_pts=20.0, per40_reb=8.0, per40_ast=4.0, per40_blk=1.0, per40_stl=1.5, per40_tov=3.0,
         hoop_score=60.0, hoop_score_raw=60.0, in_transfer_portal=None),
    dict(player_id=202, name="Portal Player", team_id=2, class_year="SO", games=15, avg_minutes=22.0,
         ppg=14.0, rpg=5.0, apg=3.0, bpg=0.5, spg=1.2, topg=2.0, ts_pct=0.50, fg_pct=0.42,
         per40_pts=25.0, per40_reb=9.0, per40_ast=5.5, per40_blk=0.9, per40_stl=2.2, per40_tov=3.6,
         hoop_score=55.0, hoop_score_raw=55.0, in_transfer_portal=1),
    dict(player_id=101, name="P5 Bench", team_id=1, class_year="FR", games=20, avg_minutes=15.0,
         ppg=8.0, rpg=3.0, apg=1.0, bpg=0.3, spg=0.5, topg=1.0, ts_pct=0.50, fg_pct=0.40,
         per40_pts=21.0, per40_reb=8.0, per40_ast=2.5, per40_blk=0.8, per40_stl=1.3, per40_tov=2.5,
         hoop_score=50.0, hoop_score_raw=50.0, in_transfer_portal=0),
    dict(player_id=301, name="Low Star A", team_id=3, class_year="JR", games=20, avg_minutes=28.0,
         ppg=16.0, rpg=6.0, apg=3.5, bpg=0.6, spg=1.8, topg=2.2, ts_pct=0.48, fg_pct=0.40,
         per40_pts=23.0, per40_reb=8.5, per40_ast=5.0, per40_blk=0.9, per40_stl=2.6, per40_tov=3.1,
         hoop_score=58.0, hoop_score_raw=58.0, in_transfer_portal=None),
    dict(player_id=401, name="Low Star B", team_id=4, class_year="SR", games=20, avg_minutes=26.0,
         ppg=15.0, rpg=7.0, apg=2.5, bpg=1.1, spg=1.4, topg=2.4, ts_pct=0.47, fg_pct=0.39,
         per40_pts=22.0, per40_reb=10.5, per40_ast=3.7, per40_blk=1.6, per40_stl=2.1, per40_tov=3.6,
         hoop_score=56.0, hoop_score_raw=56.0, in_transfer_portal=None),
]
 
# player_id -> [(season, hoop_score_raw), ...] for trajectory tests.
TRAJECTORIES = {
    501: [("2023-24", 50.0), ("2024-25", 58.0), ("2025-26", 66.0)],   # avg delta +8.0 -> Improving
    502: [("2023-24", 70.0), ("2024-25", 60.0), ("2025-26", 50.0)],   # avg delta -10.0 -> Declining
    503: [("2023-24", 55.0), ("2024-25", 56.0), ("2025-26", 54.0)],   # avg delta -0.5 -> Stable
    504: [("2025-26", 60.0)],                                        # only 1 season -> insufficient data
}
 
 
@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    c.execute("""CREATE TABLE teams (team_id INTEGER PRIMARY KEY, name TEXT, division TEXT,
        conference TEXT, tier TEXT, current_rating REAL, sos REAL)""")
    c.execute("""CREATE TABLE players (player_id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER,
        division TEXT, position TEXT, class_year TEXT, season TEXT, games INTEGER,
        avg_minutes REAL, ppg REAL, rpg REAL, apg REAL, bpg REAL, spg REAL, topg REAL,
        ts_pct REAL, fg_pct REAL,
        per40_pts REAL, per40_reb REAL, per40_ast REAL, per40_blk REAL, per40_stl REAL, per40_tov REAL,
        hoop_score REAL, hoop_score_raw REAL, in_transfer_portal INTEGER)""")
    c.execute("""CREATE TABLE team_profile (team_id INTEGER PRIMARY KEY, roster_size INTEGER,
        per40_pts REAL, per40_reb REAL, per40_ast REAL, per40_blk REAL, per40_stl REAL, per40_tov REAL,
        ts_pct REAL, fg_pct REAL)""")
    c.execute("""CREATE TABLE player_history (player_id INTEGER, name TEXT, season TEXT, team_id INTEGER,
        team_name TEXT, division TEXT, position TEXT, class_year TEXT, games INTEGER, avg_minutes REAL,
        ppg REAL, rpg REAL, apg REAL, bpg REAL, spg REAL, topg REAL, ts_pct REAL, fg_pct REAL,
        per40_pts REAL, per40_reb REAL, per40_ast REAL, per40_blk REAL, per40_stl REAL, per40_tov REAL,
        hoop_score REAL, hoop_score_raw REAL, PRIMARY KEY (player_id, season))""")
 
    meta_rows = [("season", SEASON), ("league_mean_rat", "0.0"), ("league_std_rat", "10.0")]
    for stat, (mean, std) in LEAGUE_META_STATS.items():
        meta_rows.append((f"league_mean_{stat}", str(mean)))
        meta_rows.append((f"league_std_{stat}", str(std)))
    c.executemany("INSERT INTO meta VALUES (?, ?)", meta_rows)
 
    for tid, (name, tier, rating) in TEAMS.items():
        c.execute("INSERT INTO teams VALUES (?,?,?,?,?,?,?)", (tid, name, "D1", "conf", tier, rating, 0.0))
 
    for tid, prof in TEAM_PROFILE.items():
        c.execute("""INSERT INTO team_profile VALUES (?,?,?,?,?,?,?,?,?,?)""", (
            tid, prof["roster_size"], prof["per40_pts"], prof["per40_reb"], prof["per40_ast"],
            prof["per40_blk"], prof["per40_stl"], prof["per40_tov"], prof["ts_pct"], prof["fg_pct"],
        ))
 
    for p in PLAYERS:
        c.execute("""INSERT INTO players VALUES
            (:player_id,:name,:team_id,'D1','G',:class_year,'""" + SEASON + """',:games,:avg_minutes,
             :ppg,:rpg,:apg,:bpg,:spg,:topg,:ts_pct,:fg_pct,
             :per40_pts,:per40_reb,:per40_ast,:per40_blk,:per40_stl,:per40_tov,
             :hoop_score,:hoop_score_raw,:in_transfer_portal)""", p)
 
    for pid, seasons in TRAJECTORIES.items():
        for season, hs_raw in seasons:
            c.execute("""INSERT INTO player_history VALUES
                (?,?,?,2,'Mid Team','D1','G','JR',20,25.0,10.0,4.0,3.0,0.5,1.0,2.0,0.5,0.42,
                 16.0,6.4,4.8,0.8,1.6,3.2,?,?)""", (pid, f"Traj{pid}", season, hs_raw, hs_raw))
 
    c.commit()
    return c
 
 
# ---------- 1. golden-value tests ----------
 
def test_project_player_golden_values(conn):
    """gap_std lands exactly on the TRANSFER_SPREAD_TABLE's 1.0 bucket
    center (Team 2 rating=0 -> Team 1 rating=10, std=10), so these are
    hand-computable from the documented formulas, not guessed:
      production_factor = clamp(1.06 - 10/(5.85*10), ...) = 0.88906...
      minutes_factor     = clamp(1.0 - 10/(6.4*10), ...)  = 0.84375
      proj_minutes        = clamp(25.0 * 0.84375, 4, 36)   = 21.09375 -> 21.1
      ppg = 20.0 * 0.88906 * 21.09375 / 40                 = 9.38...  -> 9.4
    """
    r = project_player(conn, player_id=201, target_team_id=1)
    assert r["gap_std"] == 1.0
    assert r["strength_gap"] == 10.0
    assert r["projected"]["minutes"] == pytest.approx(21.1, abs=0.05)
    assert r["projected"]["ppg"] == pytest.approx(9.4, abs=0.05)
    assert r["projected"]["rpg"] == pytest.approx(3.8, abs=0.05)
    assert r["confidence"] == "High"  # games=20, JR (not underclass), not extreme mismatch
    assert r["extreme_mismatch"] is False
    # TRANSFER_SPREAD_TABLE row for gap_std=1.0: (p10=0.56, p25=0.70, median=0.84, p75=1.04, p90=1.24)
    assert r["projected_range"]["ppg"][0] < r["projected"]["ppg"] < r["projected_range"]["ppg"][1]
    assert r["projected_range_wide"]["ppg"][0] < r["projected_range"]["ppg"][0]
    assert r["projected_range_wide"]["ppg"][1] > r["projected_range"]["ppg"][1]
 
 
def test_project_player_same_team_intercept(conn):
    """gap_std=0 -> production_factor == PRODUCTION_FACTOR_INTERCEPT exactly
    (1.06), a direct plug-in of the documented formula with no strength gap
    term at all. This is the real, deliberate calibration finding (real
    transfers average a small production bump) -- NOT a bug, but worth
    locking in so nobody 'fixes' it back to 1.0 without noticing it's
    intentional."""
    r = project_player(conn, player_id=201, target_team_id=2)  # same team as player 201
    assert r["strength_gap"] == 0.0
    assert r["gap_std"] == 0.0
    # production_factor=1.06, minutes_factor=1.0 -> proj_minutes=25.0, ppg=20*1.06*25/40=13.25
    assert r["projected"]["ppg"] == pytest.approx(13.3, abs=0.05)
 
 
def test_unknown_player_raises(conn):
    with pytest.raises(ProjectionError):
        project_player(conn, player_id=999999, target_team_id=1)
 
 
def test_unknown_target_team_raises(conn):
    with pytest.raises(ProjectionError):
        project_player(conn, player_id=201, target_team_id=999999)
 
 
def test_minutes_override_wins_over_role(conn):
    r = project_player(conn, player_id=201, target_team_id=1, minutes_override=30.0, role="starter")
    assert r["minutes_source"] == "coach_override"
    assert r["projected"]["minutes"] == 30.0
 
 
def test_minutes_override_out_of_range_raises(conn):
    with pytest.raises(ProjectionError):
        project_player(conn, player_id=201, target_team_id=1, minutes_override=45.0)
 
 
# ---------- 2. invariant / property tests (re-check known bug classes) ----------
 
def test_projected_range_always_brackets_point_estimate(conn):
    """The turnover-range inversion bug (already fixed once this project)
    meant topg's range didn't bracket its own point estimate for some
    strength gaps, because turnovers move OPPOSITE production_factor while
    every other stat moves WITH it. Sweep several target teams/gaps and
    verify every stat's range brackets its point estimate -- this is
    exactly the check that would have caught that bug before it shipped."""
    for target_id in (1, 2, 3, 4):
        if target_id == 2:
            continue  # player 201's own team -- skip, gap_std=0 edge case
        r = project_player(conn, player_id=201, target_team_id=target_id)
        for stat in ("ppg", "rpg", "apg", "bpg", "spg", "topg"):
            point = r["projected"][stat]
            lo, hi = r["projected_range"][stat]
            assert lo <= point <= hi, (
                f"target={target_id} stat={stat}: point {point} not in range [{lo}, {hi}] "
                f"-- range doesn't bracket the point estimate (this is the turnover-inversion bug shape)"
            )
            wlo, whi = r["projected_range_wide"][stat]
            assert wlo <= lo and hi <= whi, (
                f"target={target_id} stat={stat}: wide range [{wlo},{whi}] doesn't fully "
                f"contain the likely range [{lo},{hi}]"
            )
 
 
def test_topg_rate_moves_opposite_production(conn):
    """Direct re-check of the turnover-inversion bug: production_factor
    (points/reb/ast/etc rate) should go DOWN for a much harder target,
    while tov_factor (= 2*INTERCEPT - production_factor, see
    _core_projection) goes UP -- they move in opposite directions by
    design.
 
    Compared on a PER-40 basis (topg / minutes * 40), not raw per-game
    topg: raw topg also gets pulled down by shrinking minutes at a harder
    target (fewer minutes played, full stop), which can outweigh the
    higher turnover RATE and made a naive 'topg should just go up'
    assertion wrong here even with correct code -- confirmed numerically
    before writing this version of the test. The per-40 rate strips out
    that minutes confound and isolates the actual direction tov_factor
    moves, which is the thing the original inversion bug got backwards.
    """
    easier = project_player(conn, player_id=301, target_team_id=4)   # Low A -> Low B (easier, negative gap)
    harder = project_player(conn, player_id=301, target_team_id=1)   # Low A -> P5 (much harder, positive gap)
    assert harder["projected"]["ppg"] < easier["projected"]["ppg"], "harder target should project fewer points"
 
    def per40_rate(r, stat):
        return r["projected"][stat] / r["projected"]["minutes"] * 40.0
 
    assert per40_rate(harder, "topg") > per40_rate(easier, "topg"), (
        "harder target should project a HIGHER per-40 turnover rate (opposite direction from "
        "points/rebounds/assists) -- if this fails, the turnover-range inversion bug is back"
    )
    assert per40_rate(harder, "ppg") < per40_rate(easier, "ppg")
 
 
def test_production_factor_monotonic_in_strength_gap(conn):
    """As the target team gets stronger (higher current_rating), projected
    production should never increase -- a basic sanity property of the
    strength-gap model, independent of the exact calibration constants."""
    order = sorted(TEAMS, key=lambda tid: TEAMS[tid][2])  # team_ids sorted by current_rating ascending
    prev_ppg = None
    for tid in order:
        if tid == 3:
            continue  # player 301's own team
        r = project_player(conn, player_id=301, target_team_id=tid)
        if prev_ppg is not None:
            assert r["projected"]["ppg"] <= prev_ppg + 1e-9, (
                f"ppg should be non-increasing as target strength increases, got {prev_ppg} -> {r['projected']['ppg']}"
            )
        prev_ppg = r["projected"]["ppg"]
 
 
# ---------- 3. team_needs ----------
 
def test_needs_whole_league_golden_z(conn):
    """Whole-league meta is fully controlled (LEAGUE_META_STATS above), so
    z-scores are exact: per40_ast mean=15.0 std=4.0, Team 3's value=13.0
    -> z = (13-15)/4 = -0.5. per40_tov mean=11.0 std=2.0, Team 3's
    value=13.0 -> raw z=+1.0, flipped (lower_is_better) -> -1.0."""
    r = team_needs(conn, team_id=3, top_n=8)
    assert r["comparison_group"] == "whole league"
    assert r["level"] is None
    by_stat = {c["stat"]: c for c in r["full_profile"]}
    assert by_stat["per40_ast"]["z"] == pytest.approx(-0.5, abs=0.01)
    assert by_stat["per40_tov"]["z"] == pytest.approx(-1.0, abs=0.01)
    zs = [c["z"] for c in r["full_profile"]]
    assert zs == sorted(zs), "full_profile must be sorted worst (most negative) to best"
    assert r["weaknesses"] == r["full_profile"][:8]
 
 
def test_needs_level_filter_changes_the_verdict(conn):
    """Team 3's per40_ast reads as a mild weakness league-wide (z=-0.5,
    P5 rosters pull the mean up) but is actually the STRONGER of the two
    Low-Major teams (T3=13.0 vs T4=11.0, live mean=12.0 std=1.0 -> z=+1.0).
    This is the exact distortion the level filter exists to fix -- if this
    test fails, level filtering has stopped actually changing the
    comparison group."""
    whole = team_needs(conn, team_id=3, level=None)
    low_major = team_needs(conn, team_id=3, level="Low-Major")
    whole_ast = next(c for c in whole["full_profile"] if c["stat"] == "per40_ast")
    low_ast = next(c for c in low_major["full_profile"] if c["stat"] == "per40_ast")
    assert whole_ast["z"] == pytest.approx(-0.5, abs=0.01)
    assert low_ast["z"] == pytest.approx(1.0, abs=0.01)
    assert low_major["teams_compared"] == 2
    assert low_major["comparison_group"] == "Low-Major teams only"
 
 
def test_needs_invalid_level_raises(conn):
    with pytest.raises(ProjectionError):
        team_needs(conn, team_id=3, level="Not A Real Tier")
 
 
def test_needs_level_truly_empty_tier_raises(conn):
    # Delete the only Mid-Major team_profile row so 'Mid-Major' has 0 teams to compare against.
    conn.execute("DELETE FROM team_profile WHERE team_id = 2")
    with pytest.raises(ProjectionError):
        team_needs(conn, team_id=3, level="Mid-Major")
 
 
# ---------- 4. find_fits ----------
 
def test_fits_excludes_own_team(conn):
    r = find_fits(conn, team_id=2, stat="per40_pts")
    assert all(c["current_team"] != "Mid Team" for c in r["candidates"])
    assert 201 not in [c["player_id"] for c in r["candidates"]]
    assert 202 not in [c["player_id"] for c in r["candidates"]]
 
 
def test_fits_level_filter_excludes_other_tiers(conn):
    r = find_fits(conn, team_id=3, stat="per40_pts", level="Low-Major")
    assert r["level_filter"] == "Low-Major"
    assert all(c["level"] == "Low-Major" for c in r["candidates"])
    # player 101 (P5) and 201/202 (Mid-Major) must never appear
    ids = {c["player_id"] for c in r["candidates"]}
    assert 101 not in ids and 201 not in ids and 202 not in ids
    assert 401 in ids  # the only other Low-Major candidate not on team 3
 
 
def test_fits_invalid_level_raises(conn):
    with pytest.raises(ProjectionError):
        find_fits(conn, team_id=3, stat="per40_pts", level="Not A Real Tier")
 
 
def test_fits_invalid_stat_raises(conn):
    with pytest.raises(ProjectionError):
        find_fits(conn, team_id=3, stat="not_a_real_stat")
 
 
def test_fits_transfer_portal_only_filters_correctly(conn):
    r = find_fits(conn, team_id=1, stat="per40_pts", transfer_portal_only=True)
    ids = {c["player_id"] for c in r["candidates"]}
    assert ids == {202}  # only player 202 is flagged in_transfer_portal=1
    assert all(c["in_transfer_portal"] == 1 for c in r["candidates"])
 
 
def test_fits_transfer_portal_only_raises_when_nothing_flagged(conn):
    conn.execute("UPDATE players SET in_transfer_portal = NULL")
    with pytest.raises(ProjectionError):
        find_fits(conn, team_id=1, stat="per40_pts", transfer_portal_only=True)
 
 
def test_fits_ranking_matches_project_player(conn):
    """A ranking here and a one-off project_player() call for the same
    player+team must always agree -- they share _core_projection()."""
    r = find_fits(conn, team_id=1, stat="per40_pts", min_games=1)
    candidate = next(c for c in r["candidates"] if c["player_id"] == 301)
    direct = project_player(conn, player_id=301, target_team_id=1)
    assert candidate["projected"]["ppg"] == direct["projected"]["ppg"]
 
 
# ---------- 5. project_batch ----------
 
def test_batch_combined_is_sum_of_individual(conn):
    r = project_batch(conn, target_team_id=1, requests=[
        dict(player_id=301, minutes=None, role=None),
        dict(player_id=401, minutes=None, role=None),
    ])
    assert len(r["players"]) == 2
    expected_ppg = sum(p["projected"]["ppg"] for p in r["players"])
    assert r["combined"]["ppg"] == pytest.approx(expected_ppg, abs=0.05)
 
 
def test_batch_bad_player_goes_to_errors_not_crash(conn):
    r = project_batch(conn, target_team_id=1, requests=[
        dict(player_id=301, minutes=None, role=None),
        dict(player_id=999999, minutes=None, role=None),
    ])
    assert len(r["players"]) == 1
    assert len(r["errors"]) == 1
    assert r["errors"][0]["player_id"] == 999999
 
 
# ---------- 6. player_trajectory ----------
 
def test_trajectory_improving(conn):
    r = player_trajectory(conn, 501)
    assert r["trend"] == "Improving"
    assert r["avg_hoop_score_change_per_season"] == pytest.approx(8.0, abs=0.01)
 
 
def test_trajectory_declining(conn):
    r = player_trajectory(conn, 502)
    assert r["trend"] == "Declining"
    assert r["avg_hoop_score_change_per_season"] == pytest.approx(-10.0, abs=0.01)
 
 
def test_trajectory_stable(conn):
    r = player_trajectory(conn, 503)
    assert r["trend"] == "Stable"
    assert r["avg_hoop_score_change_per_season"] == pytest.approx(-0.5, abs=0.01)
 
 
def test_trajectory_insufficient_data(conn):
    r = player_trajectory(conn, 504)
    assert "Insufficient data" in r["trend"]
    assert r["avg_hoop_score_change_per_season"] is None
 
 
def test_trajectory_unknown_player_raises(conn):
    with pytest.raises(ProjectionError):
        player_trajectory(conn, 999999)