# Deploying this backend to Railway

Specific to what actually broke in this repo's deploy history — set these
four things in Railway's dashboard (your service → **Variables** tab)
before redeploying:

1. **`JWT_SECRET`** — this is almost certainly why the real backend was
   crash-looping and got replaced with a stub. The app deliberately
   refuses to start without a real secret (`process.exit(1)`), so it can
   never run insecurely by accident — but that also means a missing env
   var here looks, from the outside, exactly like "this file is broken."
   Generate one locally and paste the output in:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

2. **`CORS_ORIGIN`** — set to your actual GitHub Pages URL:
   ```
   CORS_ORIGIN=https://james84-bot.github.io
   ```
   (Comma-separate more than one origin if you also test from
   `http://127.0.0.1:5500` locally.)

3. **`DATABASE_PATH`, pointed at a Railway Volume — this one matters a lot.**
   Railway's container filesystem is ephemeral: without a Volume attached,
   every redeploy (including ones Railway triggers automatically) wipes
   the SQLite file and every member/loan/reservation in it. In your
   service settings:
   - Add a **Volume**, mount it at `/app/data`.
   - Set `DATABASE_PATH=/app/data/unity_shelf.db`.

4. **`STAFF_EMAIL_DOMAIN`** — defaults to `unityhomes.co.ke` if unset,
   which is probably already correct, but worth confirming explicitly.

SMTP/Africa's Talking variables are optional — leave them unset and
verification codes will print to Railway's deploy logs instead of being
emailed/texted, which is enough to test the full flow before wiring up
real providers.

## After the first successful deploy

The database starts empty — you need to seed the book catalog once.
Railway doesn't give you an interactive shell the way a local terminal
does, so use the Railway CLI from your own machine:

```bash
railway login
railway link          # select this project when prompted
railway run node scripts/seed.js seed-data/inventory.xlsx
```

That runs the seed script *inside* Railway's environment, against the
real `DATABASE_PATH` (the Volume), not your local machine.

## Confirming it actually worked

```bash
curl https://ocf-production.up.railway.app/health
# {"ok":true,"service":"unity-shelf-backend"}

curl -X POST https://ocf-production.up.railway.app/webhook/library-auth \
  -H "Content-Type: application/json" \
  -d '{"userId":"nonexistent","passcodeHash":"0000000000000000000000000000000000000000000000000000000000000000"}'
# {"authenticated":false,"message":"Check your entries."}
```

That second call is the one that matters — if you get `authenticated:
false` for a made-up user, the real login logic is running. If you get
`authenticated: true` (or `success: true`) for literally anything, the
stub is still deployed and this file didn't actually get replaced.