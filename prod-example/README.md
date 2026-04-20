# Production deployment — claw-ops-chat

Self-contained compose stack that runs `teslicvukasin/claw-ops-chat:latest`
behind an Nginx reverse proxy with WebSocket support.

## Layout

```
prod-example/
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
App**. Enter the authorized email and confirm. The installer runs
`install.sh` remotely, auto-detects SSL certs at
`/etc/letsencrypt/live/<hostname>/`, and brings the stack up.

### Option 2 — Manual

1. Copy this folder to the server (e.g. `/opt/claw-chat-src`):

   ```sh
   scp -r prod-example user@server:/tmp/claw-chat-src
   ssh user@server
   cd /tmp/claw-chat-src
   ```

2. Run the installer with required env vars:

   ```sh
   HOSTNAME=chat.example.com \
   ALLOWED_EMAIL=me@example.com \
   bash install.sh
   ```

   Optional overrides:

   ```sh
   NEXT_PUBLIC_API_ORIGIN=https://api.example.com  # default: https://$HOSTNAME
   SESSION_SECRET=$(openssl rand -hex 48)          # default: auto-generated
   ALLOWED_ORIGINS=https://chat.example.com        # default: https://$HOSTNAME
   APP_DIR=/opt/claw-chat                          # install location
   ```

3. The installer will:
   - Install Docker if missing.
   - Stop any host `nginx` service (frees port 80/443 for the sidecar).
   - Detect certs at `/etc/letsencrypt/live/$HOSTNAME/` and pick the right
     nginx template (HTTP-only vs HTTPS).
   - Render `/opt/claw-chat/.env`, `docker-compose.yml`, and
     `nginx/default.conf`.
   - Run `docker compose pull` and `docker compose up -d`.
   - Wait (up to ~60 s) for the `claw-chat` health check to pass.

4. Open the app: `https://<HOSTNAME>/chat` (or `http://<HOSTNAME>/chat` if
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
