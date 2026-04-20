# Production deployment — claw-ops-chat

Self-contained compose stack that runs `teslicvukasin/claw-ops-chat:latest`
behind an Nginx reverse proxy with WebSocket support.

## Layout

```
prod-example/
├── bootstrap.sh           # full-bootstrap entry point (deps + installer)
├── install.sh             # one-shot installer (idempotent)
├── docker-compose.yml     # reference compose (installer renders its own)
├── env.example            # reference env vars (installer writes .env for you)
└── nginx/
    ├── default.conf       # legacy reference
    ├── http-only.conf     # HTTP-only template (picked when no certs present)
    └── https.conf         # HTTPS template (picked when /etc/letsencrypt/live/$HOSTNAME/ exists)
```

## Installation

### Option 1 — Automated via ClawOps

In the ClawOps dashboard, open the server's panel and click **Install Chat
App**. Enter the authorized email and confirm. The backend runs
`bootstrap.sh` remotely, which installs every dependency (Docker, Node,
Claude CLI), auto-detects SSL certs at
`/etc/letsencrypt/live/<hostname>/`, and brings the stack up.

### Option 2 — Manual one-liner

One command on a fresh VPS, root shell:

```sh
curl -fsSL https://raw.githubusercontent.com/pejovicvuk/claw-ops-chat/main/prod-example/bootstrap.sh \
  | sudo -E HOSTNAME=chat.example.com \
             ALLOWED_EMAIL=me@example.com \
             bash
```

Pin to a specific tag or commit SHA for reproducibility:

```sh
curl -fsSL https://raw.githubusercontent.com/pejovicvuk/claw-ops-chat/v0.4.0/prod-example/bootstrap.sh \
  | sudo -E HOSTNAME=... ALLOWED_EMAIL=... INSTALLER_REF=v0.4.0 bash
```

Optional overrides (accepted by `install.sh`, pass them through to
`bootstrap.sh` via the same `sudo -E` env):

```sh
NEXT_PUBLIC_API_ORIGIN=https://api.example.com  # default: https://$HOSTNAME
SESSION_SECRET=$(openssl rand -hex 48)          # default: auto-generated
ALLOWED_ORIGINS=https://chat.example.com        # default: https://$HOSTNAME
APP_DIR=/opt/claw-chat                          # install location
```

`bootstrap.sh` runs, in order:

1. `apt update && apt upgrade -y` (or `yum update -y` on RHEL-family).
2. Installs curl, openssl, tar, sed, ca-certificates, gnupg, sudo.
3. Installs Docker (via `get.docker.com`) + `docker-compose-plugin`;
   enables the daemon on boot.
4. Installs Node.js 20 + npm, then `@anthropic-ai/claude-code` globally.
5. Removes any stale host-nginx `openclaw-managed` config for `$HOSTNAME`.
6. Downloads + SHA256-verifies `installer.tar.gz` for the pinned tag.
7. Extracts and `exec`s `install.sh`, which:
   - Stops any host `nginx` service (frees port 80/443 for the sidecar).
   - Detects certs at `/etc/letsencrypt/live/$HOSTNAME/` and picks the
     right nginx template (HTTP-only vs HTTPS).
   - Renders `/opt/claw-chat/.env`, `docker-compose.yml`, and
     `nginx/default.conf`.
   - `docker compose pull && docker compose up -d`.
   - Waits (up to ~60 s) for the `claw-chat` health check to pass.

Open the app at `https://<HOSTNAME>/chat` (or `http://<HOSTNAME>/chat` if
certs were absent).

Check logs with `sudo docker compose -f /opt/claw-chat/docker-compose.yml logs -f claw-chat`.

## Sign-in on first boot

Before anyone can actually use Claude, you need to authenticate the Claude
CLI inside the container. Either:

- **Settings → Terminal** in the UI (easiest) — run `claude auth login` from
  the in-browser terminal, or
- `sudo docker compose -f /opt/claw-chat/docker-compose.yml exec claw-chat claude auth login`
  from the server shell.

Credentials land in `/root/.claude/.credentials.json` on the host (the
compose file mounts `/root:/root`), so they persist across container
restarts.

## Enabling HTTPS (post-install)

If you installed without certs and want to switch to HTTPS later:

1. Issue a cert (the easiest route through ClawOps is to click **Provision
   SSL** on the server's dashboard):

   ```sh
   sudo certbot certonly --standalone -d your.domain.tld
   ```

2. Re-run the installer from the same source folder:

   ```sh
   HOSTNAME=your.domain.tld ALLOWED_EMAIL=me@example.com bash install.sh
   ```

   It will detect the new certs, rewrite `docker-compose.yml` with the 443
   port + cert mount, swap nginx to the HTTPS template, and `docker
   compose up -d` to apply.

Certbot renewals: run
`sudo docker compose -f /opt/claw-chat/docker-compose.yml exec nginx nginx -s reload`
after renewal to pick up the new cert, or re-run `install.sh`.

## Updating

```sh
cd /opt/claw-chat
sudo docker compose pull
sudo docker compose up -d
```

Docker will recreate `claw-chat` with the new image; existing volumes and
cookies survive.

## Notes

- `/root:/root` is mounted so Claude can read/write files on the host and
  its session history persists. That is a big mount — if you want tighter
  isolation, replace it with targeted mounts for `~/.claude/` and any
  working directories you actually need.
- The container drops all Linux capabilities except `NET_BIND_SERVICE`
  and runs behind Nginx, so nothing in the container listens on a host
  port directly — only the `claw-nginx` sidecar does.
- The in-browser Terminal page gives anyone who can sign in a full shell
  inside the container. Set `DISABLE_TERMINAL=1` in `.env` to turn it off.
