# Running FarmHand on the VPS

FarmHand has no backend of its own — the whole app is a static build that
talks to Supabase directly from the browser (the local database runs
entirely in the browser too). So unlike the baseball site, there's no
service to install or restart here: this is just pull, build, and copy the
static files into place for nginx to serve.

## Two sites

There are two copies of the same static app on this server:

| | URL | Branch | Checkout | Web root |
|---|---|---|---|---|
| live | farmhandmanager.com | `main` | `~/FarmHand` | `/var/www/farmhand` |
| dev | dev.farmhandmanager.com | `dev` | `~/FarmHand-dev` | `/var/www/farmhand-dev` |

Both are built by the same `deploy/deploy.sh`; which one it is comes from
`deploy/deploy.env` in the checkout it runs from. It refuses to run if the
checkout is not on the branch that file names, so running it in the wrong
directory fails loudly instead of publishing dev's code to the live site.

**They share one backend.** Both builds point at
`api.farmhandmanager.com` — the dev site is a preview of the *code*, not a
sandbox for the *data*. Signing in there signs into the real account and
edits the real records, which is why that build carries a permanent "dev
build" banner at the top of every screen. Two consequences worth having in
mind before you lean on it:

- A change that needs a new `db/migrations/` file needs it applied to the
  live database before dev can exercise it. So write migrations that the
  code currently on prod can live with — add a column, don't rename one —
  because prod keeps running against that schema until you promote.
- Don't use the dev site to try something destructive "just to see". It is
  the testers' data.

## One-time setup

Do this once, on the VPS.

### 1. Point DNS at this server

At wherever `independencebaseballclub.com`'s DNS is managed, add an A
record:

```
farmhandmanager.com  ->  <this server's IP>
```

(The same IP the apex/baseball site already resolves to.) Give it a few
minutes to propagate before the certbot step below.

### 2. Clone the repo

```bash
git clone https://github.com/CJohannemann/FarmHand.git ~/FarmHand
cd ~/FarmHand
```

### 3. Add your Supabase credentials

The build bakes `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` into the
static files at build time — without this file the deployed site runs in
local-only mode with no sign-in and no sync.

```bash
cp .env.example .env
nano .env   # fill in the two values from your Supabase project settings
```

### 4. Set up the web root and nginx

```bash
sudo mkdir -p /var/www/farmhand
sudo cp deploy/nginx-farmhand.conf /etc/nginx/sites-available/farmhand
sudo ln -s /etc/nginx/sites-available/farmhand /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Get a certificate

```bash
sudo certbot --nginx -d farmhandmanager.com
```

(Skip installing certbot if the baseball site already uses it — same tool,
just pointed at a second domain.) This rewrites the nginx site file in
place to add HTTPS and an http -> https redirect.

### 6. Tell deploy.sh which site this is

```bash
cp deploy/deploy.env.example deploy/deploy.env
```

The defaults are the live site — `SITE=prod`, `BRANCH=main`,
`WEB_ROOT=/var/www/farmhand`, matching step 4. Only edit it if you used a
different path.

### 7. First deploy

```bash
bash deploy/deploy.sh
```

## Setting up the dev site

Also one-time, and only after the live site above is working.

### 1. DNS — done

An A record at IONOS, alongside `farmhandmanager.com` and
`api.farmhandmanager.com`, pointing at the same IP:

```
dev.farmhandmanager.com  ->  <this server's IP>
```

Added 2026-09-10. Confirm it has propagated before the certbot step below,
or certbot's HTTP challenge fails and leaves you re-running it:

```bash
dig +short dev.farmhandmanager.com     # should print this server's IP
```

### 2. A second checkout, on the dev branch

A separate clone rather than a branch switch in the existing one: the live
site must not be one `git checkout` away from serving untested code.

```bash
git clone https://github.com/CJohannemann/FarmHand.git ~/FarmHand-dev
cd ~/FarmHand-dev
git checkout -b dev origin/dev   # or: git checkout -b dev && git push -u origin dev
```

### 3. Its .env and deploy.env

Same Supabase values as the live site — same backend:

```bash
cp ~/FarmHand/.env ~/FarmHand-dev/.env

cat > ~/FarmHand-dev/deploy/deploy.env <<'EOF'
SITE=dev
BRANCH=dev
WEB_ROOT=/var/www/farmhand-dev
PROD_REPO=/home/YOU/FarmHand
EOF
```

(`PROD_REPO` is the live checkout's full path — `promote.sh` deploys it
from here. Replace `YOU` with your username; `echo $HOME` if unsure.)

### 4. Web root, nginx, certificate

```bash
sudo mkdir -p /var/www/farmhand-dev
sudo cp deploy/nginx-farmhand-dev.conf /etc/nginx/sites-available/farmhand-dev
sudo ln -s /etc/nginx/sites-available/farmhand-dev /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dev.farmhandmanager.com
```

### 5. Let the API answer the dev origin

Not optional — without this nothing on the dev site can talk to the
backend at all, and it shows up as "could not reach the server" on the
sign-in screen rather than as anything mentioning CORS.

The API only answers CORS preflights for origins listed in the `map` in
`selfhost/nginx-farmhand-cors.conf`, and the dev site is a third origin
as far as a browser is concerned. The file already lists it; it needs
copying into place:

```bash
sudo cp ~/FarmHand-dev/deploy/selfhost/nginx-farmhand-cors.conf         /etc/nginx/conf.d/farmhand-cors.conf
sudo nginx -t && sudo systemctl reload nginx
```

This is shared nginx config, not app code, so it applies to both sites at
once. Adding an origin changes nothing about how the live site behaves.

### 6. Let Auth redirect back to the dev site

Only needed to sign UP or reset a password from dev — signing in with an
existing password works without it. The app asks Auth to send people back
to whatever origin they are on, and GoTrue refuses an origin that is not
on its allow list, falling back to the live site instead. That is already
handled in `selfhost/docker-compose.yml`; it just needs applying:

```bash
cd ~/FarmHand/deploy/selfhost
docker compose up -d auth      # recreates the one container, ~5s
```

Do this from the **live** checkout — that is where the stack's `.env`
lives. The database is untouched; nobody is signed out.

### 7. First dev deploy

```bash
cd ~/FarmHand-dev
bash deploy/deploy.sh
```

Then open https://dev.farmhandmanager.com — it should look like the live
site with an amber "dev build" strip across the top, naming the commit.

## Deploying an update

Work goes onto `dev`, gets looked at on the dev site, and is promoted from
there. Two commands, one for each half.

### 1. Put it on dev

From your machine: commit to `dev` and push. Then on the VPS:

```bash
cd ~/FarmHand-dev
bash deploy/deploy.sh
```

Pulls, installs dependencies, rebuilds, and publishes to the web root.
Refuses to run if `.env` is missing rather than quietly shipping a build
with no Supabase config, and refuses if the checkout has wandered off the
`dev` branch.

Go and look at https://dev.farmhandmanager.com. Nobody else's day is
affected by anything you do here.

### 2. Promote it to the live site

```bash
cd ~/FarmHand-dev
bash deploy/promote.sh
```

It reads the commit the dev site is *actually serving* (out of the
`build-info.json` the dev deploy published there — not the dev branch's
HEAD, which may have moved on since), checks that it fast-forwards
`main`, shows you the commits going live, flags any new
`db/migrations/` file, and asks. On yes, it pushes that exact commit to
`main` and runs `deploy.sh` in the live checkout pinned to it — so prod
can only ever end up running a commit dev already ran.

```bash
bash deploy/promote.sh --dry-run   # show what would go, change nothing
bash deploy/promote.sh --yes       # skip the confirmation
```

It stops without changing anything if `main` has commits dev has never
run (a hotfix committed straight to `main`, say). Merge `main` into
`dev`, deploy dev, look at it, then promote.

### If the change needs a migration

Neither script touches the database — deploying is only ever static files,
and FarmHand has no backend of its own to restart. A new file under
`db/migrations/` is a separate step, and because the two sites share one
database it happens **before** the dev deploy, not at promotion time:

```bash
bash deploy/selfhost/apply-migrations.sh
```

(Still on hosted Supabase rather than the self-hosted stack: paste the new
migration's SQL into the project's SQL editor instead.)

That means the live site runs against the new schema while still serving
the old code, for as long as the change sits on dev. Additive migrations —
a new column, a new table, a new default — are fine that way. A rename or
a drop is not: it breaks prod the moment it is applied. Do those as
add-then-promote-then-remove, across two deploys.

`promote.sh` lists any migration the promotion carries and reminds you,
but it cannot check whether you actually ran it.

### What is live right now

Each deploy stamps the web root, so this is answerable rather than
remembered:

```bash
curl -s https://farmhandmanager.com/build-info.json
curl -s https://dev.farmhandmanager.com/build-info.json
```

### If you need to ship straight to prod

Nothing stops you — `cd ~/FarmHand && bash deploy/deploy.sh` still works
on its own, for a hotfix at 6am. Just merge `main` back into `dev`
afterwards, or the next promotion will refuse as a non-fast-forward.


## Space

The local-database engine (PGlite) ships an ~8MB WASM build plus a ~5MB
data file, and `node_modules` for a full `npm ci` (including the build
tools) runs a few hundred MB. If the VPS is tight on disk, `rm -rf
node_modules` between deploys frees that back up — the next `deploy.sh`
just reinstalls it, at the cost of a slower build.

The second checkout doubles the `node_modules` cost, and it is the one
that can afford to be slow: if disk gets tight, `rm -rf
~/FarmHand-dev/node_modules` after a dev deploy is the first thing to
reach for. Nothing else about the dev site costs anything at rest — it is
static files sharing the live site's nginx and backend.

## If something looks wrong after a deploy

```bash
sudo nginx -t                 # is the config even valid?
curl -I https://farmhandmanager.com
curl -s https://farmhandmanager.com/build-info.json   # what is actually deployed?
```

There's no service to check `journalctl` for — if the site is broken, it's
either the nginx config, the certificate, or `.env` missing/wrong at build
time (which shows up as the local-only banner and no sign-in screen).
