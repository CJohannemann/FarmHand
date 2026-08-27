# Self-hosting FarmHand's backend

Replaces Supabase's hosted project with the same three pieces — Postgres,
its REST API, and Auth — running as Docker containers on this VPS instead.
Nothing about the app's code changes; `@supabase/supabase-js` just gets
pointed at a different URL and key. The frontend (already deployed per
`../README.md`) is unaffected by any of this until the very last step.

**Expect this to take some back-and-forth.** This is a bigger, more moving-
parts change than deploying static files, and there's no way for either of
us to fully dry-run it before it's live. Go through it one step at a time
rather than pasting the whole thing into a terminal at once, and check the
"Sanity check" after each stage before moving on — that's where a problem
will actually show itself, rather than three steps later as something
confusing.

## 0. A swap file, first

No swap is currently configured. Cheap insurance against the OOM killer
taking something down abruptly instead of the system just slowing down:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # should now show ~2G under Swap
```

## 1. Install Docker, if it isn't already

```bash
docker --version
```

If that fails: [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)
has the current install commands — worth following their page directly
rather than a copy here, since the exact commands change over time.

## 2. DNS

Same as the frontend subdomain — add another A record at IONOS:

```
api.independencebaseballclub.com  ->  <this server's IP>
```

## 3. Secrets

```bash
cd ~/FarmHand/deploy/selfhost
cp .env.example .env
```

Generate the two random secrets. `POSTGRES_PASSWORD` ends up embedded
directly inside connection URLs (`postgres://authenticator:PASSWORD@...`),
so it needs `-hex` rather than `-base64` — base64 can contain `/`, `+`, or
`=`, and an unescaped `/` in particular gets misread as a path separator,
corrupting the URL. `JWT_SECRET` is never embedded in a URL, so `-base64`
is fine for it:

```bash
openssl rand -hex 32      # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> JWT_SECRET
```

Put both into `.env` (`nano .env`). Then, using that same `JWT_SECRET`
value, mint the two API keys:

```bash
node mint-jwt.mjs "<paste JWT_SECRET here>" anon
node mint-jwt.mjs "<paste JWT_SECRET here>" service_role
```

Paste each result into `.env` as `ANON_KEY` and `SERVICE_ROLE_KEY`. Fill in
the `SMTP_*` values from whichever mail provider you're using — this is
required for password-reset emails to send at all.

## 4. Bring up Postgres, then Auth, in that order

Order matters here: GoTrue bootstraps the `auth` schema, roles, and helper
functions (`auth.uid()` etc.) that FarmHand's schema depends on, so it has
to exist before step 5.

```bash
docker compose up -d db
docker compose logs -f db
```

Give it 20–30 seconds on first boot (it's running its own init scripts),
then Ctrl-C out of the log follow once it settles — look for it to stop
printing new lines, not for a specific "ready" message.

The image only sets a password for its own admin user automatically — the
accounts GoTrue and PostgREST actually connect as have none yet, and both
will fail to start without this:

```bash
bash set-role-passwords.sh
```

```bash
docker compose up -d auth
docker compose logs -f auth
```

**Sanity check** — no errors in that log, and:

```bash
docker compose exec db psql -U postgres -d postgres -c "\dn"
```

should list an `auth` schema.

## 5. Load FarmHand's schema

```bash
bash apply-schema.sh
```

This runs `schema.sql`, `seed.sql`, and every file in `db/migrations/` in
order. **Sanity check**: the script's last line runs `select auth.uid();`
— it should print a blank/null row, not an error. An error here means step
4 didn't finish the way it needed to; check `docker compose logs auth`
again before going further.

This script is for this brand-new database only, run this one time.
Re-running it later — say, after pulling a commit that added a
migration — fails immediately with something like `relation "farm"
already exists`: `schema.sql` and `seed.sql` aren't written to be run
twice. See "Applying a new migration" under Day to day, below, for that
case instead.

## 6. Start the REST API

```bash
docker compose up -d rest
docker compose logs -f rest
```

**Sanity check**, from inside the VPS (bypasses nginx/DNS entirely, so a
failure here is about the containers, not the network in front of them):

```bash
source .env
curl -i "http://127.0.0.1:8001/asset?select=id&limit=1" -H "apikey: $ANON_KEY"
```

Expect `HTTP/1.1 200` and `[]` (or real rows). Anything else — stop and
paste the output before moving on to nginx.

## 7. nginx + certificate

```bash
sudo cp nginx-farmhand-api.conf /etc/nginx/sites-available/farmhand-api
sudo ln -s /etc/nginx/sites-available/farmhand-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.independencebaseballclub.com
```

**Sanity check**, this time through the real domain:

```bash
curl -i "https://api.independencebaseballclub.com/rest/v1/asset?select=id&limit=1" -H "apikey: $ANON_KEY"
```

Same expectation as step 6 — `200` and `[]`/rows.

## 8. Point FarmHand at it

```bash
cd ~/FarmHand
nano .env
```

Change:

```
VITE_SUPABASE_URL=https://api.independencebaseballclub.com
VITE_SUPABASE_ANON_KEY=<the ANON_KEY from deploy/selfhost/.env>
```

Then rebuild and republish:

```bash
bash deploy/deploy.sh
```

## 9. Starting fresh vs. migrating existing data

This is a **new, empty** database — the account and farm data on the
Supabase-hosted project doesn't carry over automatically. Recommended:
just sign up again on the deployed site, same as the very first time. Any
device's local data (the real farm records living in its browser) isn't
touched by any of this — it's independent of which remote backend it
happens to sync against, so signing up fresh here and syncing that device
again reconstructs everything with nothing lost, the same way linking to
Supabase originally did.

A full data migration (`pg_dump` from the hosted project, restore here) is
possible, but is a meaningfully bigger, riskier undertaking — carrying
across `auth.users` password hashes and every table's rows while keeping
ids and RLS both intact — and isn't necessary given how little is at stake
in the hosted project right now. Ask if you want to go that route instead
and we'll plan it out separately.

## Day to day

```bash
cd ~/FarmHand/deploy/selfhost
docker compose ps                  # is everything up?
docker compose logs -f auth        # or rest, or db
docker compose restart rest        # or auth, or db
```

### Applying a new migration

A commit that adds a file under `db/migrations/` needs its own step here —
`../deploy.sh` only rebuilds and republishes the frontend, it never
touches the database.

```bash
cd ~/FarmHand
git pull
bash deploy/selfhost/apply-migrations.sh
```

Safe to run anytime, including when nothing's new — every migration file
guards itself against running twice. Don't reach for `apply-schema.sh`
here; see the note on it in step 5 above.

## Backups

`./data/db` on the VPS *is* the database now — back it up like you would
any other data you can't afford to lose:

```bash
docker compose exec db pg_dump -U postgres postgres | gzip > ~/farmhand-backup-$(date +%F).sql.gz
```

Worth turning into a cron job or a systemd timer (the baseball site's
`ibc-backup.timer` is a working example of the latter, in `../../deploy/`
of the IBC repo) once this is confirmed working — not blocking on that for
the initial setup, but don't let it be the thing that's forgotten either.

## Disk space warning

At real-world data volumes this VPS's disk fills so slowly it's not worth
routinely checking by hand — see the capacity-planning conversation this
came out of. `check-disk.sh` checks the root filesystem daily and warns
you once it crosses a threshold, so a slow, boring problem doesn't turn
into a sudden one.

```bash
cd ~/FarmHand/deploy/selfhost
cp check-disk.env.example check-disk.env
nano check-disk.env   # fill in NTFY_TOPIC and/or MAIL_TO — both optional
sudo cp farmhand-disk-check.service farmhand-disk-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now farmhand-disk-check.timer
```

**Sanity check**:

```bash
sudo systemctl start farmhand-disk-check.service   # runs it once, right now
journalctl -u farmhand-disk-check.service -n 20
```

Should print the current usage percentage and free space. It's silent
(exit 0, no output) below the threshold — the log line above only shows
because you just ran it manually; the timer's real daily runs only leave
a journal entry worth noticing once it actually fires a warning.

The two service/timer files assume the repo lives at
`/home/ubuntu/FarmHand` under a user named `ubuntu` — edit `User=` and
`WorkingDirectory=` in `farmhand-disk-check.service` first if that's not
this VPS.
