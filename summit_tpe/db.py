"""SQLite persistence layer for the Summit TPE prototype.

Minimal schema covering the four core tables described in the product
spec (Team, Player, Game, Player Game Stats). Uses stdlib sqlite3 only
-- no ORM, no external dependencies. Good enough to prove out the PDI
engine end to end; a production build would likely move this to
Postgres and add the future fields noted inline (home court rating,
recruit ranking, handedness, on/off, etc.).
"""

import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS team (
    team_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    division      TEXT NOT NULL CHECK (division IN ('D1', 'D2')),
    conference    TEXT NOT NULL,
    season        TEXT NOT NULL,
    tempo         REAL NOT NULL DEFAULT 70.0,    -- possessions per 40 min
    rating        REAL NOT NULL DEFAULT 1500.0   -- last-computed strength rating
    -- future: conference_rating, offensive_rating, defensive_rating,
    -- home_court_rating, record
);

CREATE TABLE IF NOT EXISTS player (
    player_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    team_id       TEXT NOT NULL REFERENCES team(team_id),
    position      TEXT NOT NULL CHECK (position IN ('PG', 'SG', 'WING', 'FORWARD', 'CENTER')),
    class_year    TEXT NOT NULL CHECK (class_year IN ('FR', 'SO', 'JR', 'SR', 'GR')),
    height_in     INTEGER
    -- future: experience (years played), transfer_history, handedness,
    -- recruit_ranking
);

CREATE TABLE IF NOT EXISTS game (
    game_id       TEXT PRIMARY KEY,
    season        TEXT NOT NULL,
    date          TEXT NOT NULL,
    home_team_id  TEXT NOT NULL REFERENCES team(team_id),
    away_team_id  TEXT NOT NULL REFERENCES team(team_id),
    home_score    INTEGER NOT NULL,
    away_score    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_game_stat (
    player_id     TEXT NOT NULL REFERENCES player(player_id),
    game_id       TEXT NOT NULL REFERENCES game(game_id),
    team_id       TEXT NOT NULL REFERENCES team(team_id),
    opponent_id   TEXT NOT NULL REFERENCES team(team_id),
    minutes       REAL NOT NULL,
    points        INTEGER NOT NULL,
    fgm           INTEGER NOT NULL,
    fga           INTEGER NOT NULL,
    fg3m          INTEGER NOT NULL,
    fg3a          INTEGER NOT NULL,
    ftm           INTEGER NOT NULL,
    fta           INTEGER NOT NULL,
    oreb          INTEGER NOT NULL,
    dreb          INTEGER NOT NULL,
    ast           INTEGER NOT NULL,
    stl           INTEGER NOT NULL,
    blk           INTEGER NOT NULL,
    tov           INTEGER NOT NULL,
    pf            INTEGER NOT NULL,
    started       INTEGER NOT NULL DEFAULT 0,
    margin        INTEGER NOT NULL,   -- team_score - opponent_score for this game
    PRIMARY KEY (player_id, game_id)
);
"""


def connect(db_path):
    """Open a SQLite connection with row access by column name."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn):
    """Create all tables if they don't already exist."""
    conn.executescript(SCHEMA)
    conn.commit()
