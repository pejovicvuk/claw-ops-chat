# Production deployment — claw-ops-chat

Self-contained compose stack that runs `teslicvukasin/claw-ops-chat:latest`
behind an Nginx reverse proxy with WebSocket support.

## Layout

```
prod-example/
├── docker-compose.yml     # claw-chat + nginx
├── env.example            # rename to .env and fill in
└── nginx/
    └── default.conf       # proxy config (WS upgrade + optional HTTPS)
```

## Quick start

1. Copy this folder to the server (e.g. `/opt/claw-chat`) and `cd` into it.
2. Create and edit the env file:
   ```sh
   mv env.example .env
   nano .env        # fill in NEXT_PUBLIC_API_ORIGIN, ALLOWED_EMAIL, SESSION_SECRET, ALLOWED_ORIGINS
   ```
3. Pull the image and bring the stack up:
   ```sh
   docker compose pull
   docker compose up -d
   ```
4. Point your domain's A record at the server. The app is served at
   `http://<your-domain>/chat`.

Check logs with `docker compose logs -f claw-chat`.

## Sign-in on first boot

Before anyone can actually use Claude, you need to authenticate the Claude
CLI inside the container. Either:

- **Settings → Terminal** in the UI (easiest) — run `claude auth login` from
  the in-browser terminal, or
- `docker compose exec claw-chat claude auth login` from the server shell.

Credentials land in `/root/.claude/.credentials.json` on the host (the
compose file mounts `/root:/root`), so they persist across container
restarts.

## Enabling HTTPS

The stack ships with HTTP only so it boots cleanly on first run. To add
TLS:

1. Get certs (Let's Encrypt via `certbot` on the host is the usual path):
   ```sh
   sudo certbot certonly --standalone -d your.domain.tld
   ```
2. Copy (or symlink) the cert files into `nginx/certs/`:
   ```
   nginx/certs/fullchain.pem
   nginx/certs/privkey.pem
   ```
3. In [docker-compose.yml](docker-compose.yml):
   - Uncomment `- "443:443"` under the nginx `ports:` block.
   - Uncomment the `./nginx/certs:/etc/nginx/certs:ro` volume line.
4. In [nginx/default.conf](nginx/default.conf):
   - Uncomment the HTTPS `server { ... }` block and set `server_name` to
     your domain.
   - Change the HTTP block's `location /` to
     `return 301 https://$host$request_uri;` to force redirects.
5. `docker compose up -d` to apply.
6. Also update `.env`:
   `ALLOWED_ORIGINS=https://your.domain.tld`
   (must match exactly — scheme + host, no trailing slash).

Certbot renewals: run `docker compose exec nginx nginx -s reload` after
each renewal to pick up the new cert.

## Updating

```sh
docker compose pull
docker compose up -d
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
  port directly — only Nginx does.
- The in-browser Terminal page gives anyone who can sign in a full shell
  inside the container. Set `DISABLE_TERMINAL=1` in `.env` to turn it off.
