# Deploying the Summit TPE API

## Does my computer need to stay on?

No -- that's the point of this setup. Once deployed, the API runs inside a container on Render's or Fly's own servers, entirely independent of your machine. Your computer is only involved when you want to **ship a data refresh**: run `refresh_pipeline.py` locally as you already do, rebuild the Docker image, and redeploy -- a couple minutes of work, then your machine can go back to sleep. The live site keeps serving traffic the whole time in between, whether your laptop is on, off, or at the bottom of a lake.

The one thing to watch: **free tiers spin down when idle.** Render's free web service tier stops the container after ~15 minutes with no requests and takes 30-60 seconds to wake back up on the next one -- fine for testing, not great for a public site's first impression. The $7/mo Starter tier (or Fly with `min_machines_running = 1`, in `fly.toml`) keeps one instance always warm. That's the main thing your budget buys here.

## Step 1 -- get the pieces in place

Copy these files into your `HoopScoreImporter` folder, next to `api.py`:

- `Dockerfile`
- `.dockerignore`
- `requirements-api.txt`

Pick **one** of `render.yaml` or `fly.toml` depending on which platform you go with (both work off the same Dockerfile -- try either, or both, cheaply).

## Step 2a -- deploy to Render (simplest)

1. Push this folder to a GitHub repo (Render deploys from a repo; it doesn't take a raw folder upload from your machine directly).
2. On [render.com](https://render.com), "New +" -> "Blueprint", point it at the repo. It reads `render.yaml` automatically.
3. In the Render dashboard, set the real `SUMMIT_TPE_API_KEY` value (generate one locally: `python -c "import secrets; print(secrets.token_urlsafe(32))"`). It's deliberately left out of `render.yaml` (`sync: false`) so it never ends up committed to the repo.
4. Once live, hit `https://<your-service>.onrender.com/health` to confirm it's serving.

## Step 2b -- deploy to Fly.io (CLI-based, no GitHub repo required)

1. Install `flyctl`, then from the `HoopScoreImporter` folder:
   ```
   flyctl auth login
   flyctl launch --no-deploy      # detects fly.toml, asks to confirm the app name
   flyctl secrets set SUMMIT_TPE_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
   flyctl deploy
   ```
2. `flyctl status` gives you the live URL; `/health` confirms it's serving.

Fly doesn't require a GitHub repo -- it deploys straight from your local folder, which some people find easier when a repo isn't already in place.

## Step 3 -- lock down access before calling it public

`api.py` already refuses to stay quiet about this -- it prints a startup warning if either is left unset:

- `SUMMIT_TPE_API_KEY` -- set it (step above). Every route except `/health` then requires it.
- `SUMMIT_TPE_ALLOWED_ORIGINS` -- currently `"*"` in both config files. Once your website has a real domain, change this to that exact domain (e.g. `https://summittpe.com`) so browsers won't let other sites call your API using a visitor's session.

## Shipping a data refresh later

```
python refresh_pipeline.py --path WomensSummitTPE.xlsx --sport women   # produces summit_tpe_cache_women.sqlite
python refresh_pipeline.py --path MensSummitTPE.xlsx --sport men       # produces summit_tpe_cache_men.sqlite (once you have men's data)
docker build -t summit-tpe-api .                                        # rebuild the image with the new data baked in
# Render: git push (if autoDeploy is on, this alone triggers a redeploy)
# Fly:    flyctl deploy
```

Refresh whichever sport(s) actually changed -- each sport's cache file is independent, so a women's-only data update doesn't require touching the men's file at all (or vice versa). The Docker build only hard-requires `summit_tpe_cache_women.sqlite` to exist (see the Dockerfile's own note) -- `summit_tpe_cache_men.sqlite` is picked up automatically if present.

## What's NOT in this phase

This deploys the API exactly as it works today, backed by the same SQLite cache, just running on a public host instead of your laptop. It does **not** yet move the data to Supabase Postgres -- that's a separate, optional next step (`supabase_schema.sql` in this same delivery) worth doing once you want user accounts, saved favorites, or tiered API keys for the app. It's not required to get a working public site and API today.

## Rough cost, once actually live

| Piece | Cheapest workable option | Cost |
|---|---|---|
| Backend API (Render Starter, always-on) | Render | $7/mo |
| ...or backend API (Fly, 512MB, always-on) | Fly.io | ~$4-7/mo |
| Website frontend (Next.js on Vercel Hobby) | Vercel | $0/mo (personal-project tier; see note below) |
| Database (Supabase Free, once/if you migrate) | Supabase | $0/mo up to 500MB / 5GB egress |
| Domain name | Namecheap/Google Domains/etc. | ~$1/mo (~$10-15/yr) |

**Realistic starting cost: $0-8/month** -- basically just the backend, since a small reference dataset like this fits comfortably in every relevant free tier. It stays that low until you either want zero cold starts from day one (the $7/mo Starter tier) or the site gets enough real traffic/data volume to outgrow Supabase's free tier (500MB DB, 5GB egress/month -- a long way off at this data's current size).

**If it grows** -- real public traffic, Supabase Pro for backups/more egress ($25/mo), Vercel Pro if this becomes a commercial product (Vercel's free Hobby tier is meant for personal/non-commercial projects -- worth checking their current terms once this is generating revenue) -- a realistic middle-of-the-road total lands around **$30-50/month**. That's still well short of needing a dedicated server or DevOps time.

Sources checked directly against each platform's pricing page (Aug 2026): [Supabase](https://supabase.com/pricing), [Render](https://render.com/pricing), [Fly.io](https://fly.io/docs/about/pricing/), [Vercel](https://vercel.com/pricing).
