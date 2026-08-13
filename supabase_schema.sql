-- Summit TPE -- Postgres/Supabase schema
--
-- Direct translation of the 5 tables build_cache.py currently writes to
-- summit_tpe_cache.sqlite (meta, teams, players, team_profile,
-- player_history), plus the same 4 indexes, plus Row-Level Security
-- policies appropriate for public read-only reference data.
--
-- This is Phase 2 (adding Supabase Postgres for auth/user accounts down
-- the line) -- it is NOT required to deploy the API publicly today. The
-- Dockerfile in this same folder ships with the existing sqlite cache
-- baked in and works on its own. Run this in the Supabase SQL editor
-- whenever you're ready to start that migration; see DEPLOY.md for what
-- else changes in api.py / build_cache.py to actually point at it.
--
-- Run this once, in the Supabase SQL editor, against a fresh project.

create table meta (
    key   text primary key,
    value text
);

create table teams (
    team_id        integer primary key,
    name           text,
    division       text,
    conference     text,
    tier           text,
    current_rating double precision,
    sos            double precision
);

create table players (
    player_id           integer primary key,
    name                text,
    team_id             integer references teams(team_id),
    division            text,
    position            text,
    class_year          text,
    season              text,
    games               integer,
    avg_minutes         double precision,
    ppg                 double precision,
    rpg                 double precision,
    apg                 double precision,
    bpg                 double precision,
    spg                 double precision,
    topg                double precision,
    ts_pct              double precision,
    fg_pct              double precision,
    per40_pts           double precision,
    per40_reb           double precision,
    per40_ast           double precision,
    per40_blk           double precision,
    per40_stl           double precision,
    per40_tov           double precision,
    hoop_score          double precision,
    hoop_score_raw      double precision,
    in_transfer_portal  integer
);

create table team_profile (
    team_id     integer primary key references teams(team_id),
    roster_size integer,
    per40_pts   double precision,
    per40_reb   double precision,
    per40_ast   double precision,
    per40_blk   double precision,
    per40_stl   double precision,
    per40_tov   double precision,
    ts_pct      double precision,
    fg_pct      double precision
);

create table player_history (
    player_id      integer,
    name           text,
    season         text,
    team_id        integer references teams(team_id),
    team_name      text,
    division       text,
    position       text,
    class_year     text,
    games          integer,
    avg_minutes    double precision,
    ppg            double precision,
    rpg            double precision,
    apg            double precision,
    bpg            double precision,
    spg            double precision,
    topg           double precision,
    ts_pct         double precision,
    fg_pct         double precision,
    per40_pts      double precision,
    per40_reb      double precision,
    per40_ast      double precision,
    per40_blk      double precision,
    per40_stl      double precision,
    per40_tov      double precision,
    hoop_score     double precision,
    hoop_score_raw double precision,
    primary key (player_id, season)
);

-- Same 4 indexes build_cache.py creates on the sqlite cache today.
create index idx_players_name   on players(name);
create index idx_players_team   on players(team_id);
create index idx_teams_tier     on teams(tier);
create index idx_history_player on player_history(player_id);

-- ---- Row-Level Security ----
-- All 5 tables are public reference data (team/player stats), not
-- per-user data -- safe to expose read-only to anyone holding the
-- anon key. Writes (refreshing the cache) should only ever happen via
-- the service_role key from your own refresh pipeline, which bypasses
-- RLS entirely by design in Supabase -- so no INSERT/UPDATE/DELETE
-- policy is defined below on purpose. That's what keeps a public site
-- from being able to write to your data even if someone extracts your
-- anon key from the frontend's network traffic (which they always can).

alter table meta           enable row level security;
alter table teams          enable row level security;
alter table players        enable row level security;
alter table team_profile   enable row level security;
alter table player_history enable row level security;

create policy "public read" on meta           for select using (true);
create policy "public read" on teams          for select using (true);
create policy "public read" on players        for select using (true);
create policy "public read" on team_profile   for select using (true);
create policy "public read" on player_history for select using (true);

-- Once you add user accounts (favorites, saved shortlists, etc. -- the
-- "app" features), those go in NEW tables with their own RLS policies
-- scoped to auth.uid(), e.g.:
--
-- create table user_favorites (
--     user_id   uuid references auth.users(id) not null,
--     player_id integer references players(player_id) not null,
--     created_at timestamptz default now(),
--     primary key (user_id, player_id)
-- );
-- alter table user_favorites enable row level security;
-- create policy "read own favorites" on user_favorites
--     for select using (auth.uid() = user_id);
-- create policy "insert own favorites" on user_favorites
--     for insert with check (auth.uid() = user_id);
