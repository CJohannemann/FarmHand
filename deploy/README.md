# Running FarmHand on the VPS

FarmHand has no backend of its own — the whole app is a static build that
talks to Supabase directly from the browser (the local database runs
entirely in the browser too). So unlike the baseball site, there's no
service to install or restart here: this is just pull, build, and copy the
static files into place for nginx to serve.

## One-time setup

Do this once, on the VPS.

### 1. Point DNS at this server

At wherever `independencebaseballclub.com`'s DNS is managed, add an A
record:

```
farmhand.independencebaseballclub.com  ->  <this server's IP>
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
sudo certbot --nginx -d farmhand.independencebaseballclub.com
```

(Skip installing certbot if the baseball site already uses it — same tool,
just pointed at a second domain.) This rewrites the nginx site file in
place to add HTTPS and an http -> https redirect.

### 6. Tell deploy.sh where to publish

```bash
cp deploy/deploy.env.example deploy/deploy.env
```

Default is `/var/www/farmhand`, matching step 4 — only edit it if you used
a different path.

### 7. First deploy

```bash
bash deploy/deploy.sh
```

## Deploying an update

```bash
cd ~/FarmHand
bash deploy/deploy.sh
```

Pulls, installs dependencies, rebuilds, and publishes to the web root.
Refuses to run if `.env` is missing rather than quietly shipping a build
with no Supabase config.

This only ever touches static files — FarmHand has no backend of its own
to restart. But if the update includes a new file under `db/migrations/`,
the *database* needs its own separate step too, or the frontend ends up
calling something the schema doesn't have yet. Self-hosting per
`selfhost/README.md`: run `bash deploy/selfhost/apply-migrations.sh`.
Still on hosted Supabase: apply the new migration file's SQL via the
project's SQL editor.

## Space

The local-database engine (PGlite) ships an ~8MB WASM build plus a ~5MB
data file, and `node_modules` for a full `npm ci` (including the build
tools) runs a few hundred MB. If the VPS is tight on disk, `rm -rf
node_modules` between deploys frees that back up — the next `deploy.sh`
just reinstalls it, at the cost of a slower build.

## If something looks wrong after a deploy

```bash
sudo nginx -t                 # is the config even valid?
curl -I https://farmhand.independencebaseballclub.com
```

There's no service to check `journalctl` for — if the site is broken, it's
either the nginx config, the certificate, or `.env` missing/wrong at build
time (which shows up as the local-only banner and no sign-in screen).
