# Off-site backups: VPS → home server

The farm's records live on a rented VPS. This puts a second copy on a machine
you own, on a nightly timer, so losing the VPS — hardware, billing dispute,
fat-fingered `docker compose down -v` — doesn't lose the data.

## How it's put together

The VPS **pushes**. That's the direction you asked for, and it means your home
server needs no static IP and no dynamic DNS — but it does mean the
internet-facing machine holds a key into your home network. So the receiving
end is deliberately narrow:

```
  VPS                                   home server
  ───                                   ───────────
  push-backup.sh                        sshd
    pg_dump -Fc  ──stream──►  forced command: receive-backup.sh
                                          │  can ONLY create a new
                                          │  timestamped file
                                          ▼
                                        drop/
                                          │  rotate-backups.sh
                                          │  (different user, hourly)
                                          ▼
                                        archive/{daily,weekly,monthly}
```

`receive-backup.sh` cannot list, read, overwrite, or delete. `rotate-backups.sh`
runs as a **different user the VPS has no key for**, and owns the archive. So an
attacker who owns the VPS can push garbage or stop pushing — both of which raise
an alert — but cannot reach back and erase history. That property is the whole
reason the pieces are split this way; don't collapse them into one account.

The dump is streamed straight into `ssh` and never written to the VPS's own
disk. That box has 38GB shared with another site; staging a dump there before
sending it is how a backup fills the disk it's backing up.

## Setting it up

### 1. On the home server — a locked-down account

```bash
sudo useradd -m -d /srv/farmhand-backup farmhand      # the VPS logs in as this
sudo useradd -r farmhand-archive                      # owns the archive; VPS has no key
sudo mkdir -p /srv/farmhand-backup/{drop,archive}
sudo cp rotate-backups.sh backup.env /srv/farmhand-backup/
sudo cp receive-backup.sh /srv/farmhand-backup/       # must be root-owned, see below
sudo chown root:root /srv/farmhand-backup/receive-backup.sh
sudo chmod 755 /srv/farmhand-backup/receive-backup.sh
sudo chown farmhand:farmhand /srv/farmhand-backup/drop
sudo chown -R farmhand-archive:farmhand-archive /srv/farmhand-backup/archive
sudo apt install postgresql-client                    # for pg_restore, see Verification
```

`receive-backup.sh` is root-owned on purpose: it's the forced command, so if the
`farmhand` account could edit it, that account could replace it and escape the
restriction.

### 2. On the VPS — a key that can do nothing else

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/farmhand_backup -C farmhand-vps
cat ~/.ssh/farmhand_backup.pub
```

### 3. Back on the home server — pin that key to the forced command

In `/srv/farmhand-backup/.ssh/authorized_keys`, on one line:

```
command="/srv/farmhand-backup/receive-backup.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...  farmhand-vps
```

Everything before the key type is what makes this safe. Without `command=`, that
key is a shell on your home server.

### 4. Configure and install the timers

```bash
# VPS
cp backup.env.example backup.env    # set BACKUP_SSH_TARGET, BACKUP_SSH_KEY
bash push-backup.sh                 # run once by hand before trusting a timer
sudo cp farmhand-backup.service farmhand-backup.timer /etc/systemd/system/
sudo systemctl enable --now farmhand-backup.timer

# home server
sudo cp farmhand-backup-rotate.service farmhand-backup-rotate.timer /etc/systemd/system/
sudo systemctl enable --now farmhand-backup-rotate.timer
```

## Verification

`rotate-backups.sh` refuses to archive a file unless it starts with `PGDMP` and
clears `pg_restore --list`. **Install `postgresql-client`.** Without it only the
header is checked — verified in testing that a truncated dump otherwise passes,
which is exactly the failure you'd discover on the worst possible day. The
script says so out loud rather than degrading quietly.

It also alerts when the newest archived dump is older than `STALE_HOURS`. A
push that quietly stopped weeks ago looks identical to one that's working.

## Restoring

```bash
# database
scp home:/srv/farmhand-backup/archive/daily/farmhand-<stamp>.dump .
docker compose exec -T db psql -U postgres -c 'drop database if exists restored'
docker compose exec -T db psql -U postgres -c 'create database restored'
docker compose exec -T db pg_restore -U postgres -d restored --no-owner < farmhand-<stamp>.dump
```

Restore into `restored` first and look at it. Restoring straight over a live
database turns a bad backup into two bad databases.

The config bundle holds `.env`, and `.env` holds `JWT_SECRET`. Rebuilding with a
fresh secret silently invalidates every existing session and password-reset
link, so a database-only restore is not a working system.

## A note on the config bundle

`farmhand-config-*.tar.gz` contains `POSTGRES_PASSWORD` and `JWT_SECRET` in
plain text. It's as sensitive as the database. Keep the archive directory
non-readable to other users, and if the home server's disk isn't encrypted,
consider `age`/`gpg` on that file — or set `BACKUP_INCLUDE_CONFIG=0` and keep
those two secrets in a password manager instead.
