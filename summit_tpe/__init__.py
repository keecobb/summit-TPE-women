"""Summit TPE -- Translation Performance Engine.

Prototype package. Everything here is stdlib-only (sqlite3, math,
random, statistics) so it runs with no pip installs.

Modules:
    utils      -- small numeric helpers (clamp, logistic)
    db         -- SQLite schema + connection helpers
    seed_data  -- synthetic D1/D2 teams, players, games, box scores
    ratings    -- Elo-style team strength network
    weighting  -- close-game possession weighting
    pdi        -- the core Projection Data Index engine
    transfer   -- first-pass transfer translation projector
"""
