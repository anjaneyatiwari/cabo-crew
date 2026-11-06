# Cabo Crew

Group trip app for 5 families at Riu Palace Cabo San Lucas, Dec 24–28, 2026.

- `public/index.html` — the whole app (no build step)
- `src/worker.js` — trip API: families, members, figurines, AI figurines via Gemini
- `wrangler.jsonc` — Worker config, D1 binding, trip code
- `schema.sql` — D1 tables (already applied)

## Deploy

Connected to Cloudflare Workers Builds: every push to `main` deploys automatically.

## Invite link

`https://<worker-url>/?code=<TRIP_CODE>` — the trip code is in `wrangler.jsonc`.

## AI figurines

Set the `GEMINI_API_KEY` secret on the `cabo-crew` Worker (Settings → Variables and Secrets).
Without it, figurines are made on the phone. Daily cap: `AI_DAILY_CAP` in `src/worker.js`.
