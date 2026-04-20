#!/usr/bin/env bash
# Claw Chat bootstrap — prepares a bare VPS and runs the claw-chat installer.
#
# Usage (manual):
#   curl -fsSL https://raw.githubusercontent.com/pejovicvuk/claw-ops-chat/main/prod-example/bootstrap.sh \
#     | sudo -E HOSTNAME=chat.example.com \
#                ALLOWED_EMAIL=me@example.com \
#                bash
#
# What this does, in order:
#   1.  apt/yum update + upgrade (non-interactive).
#   2.  Install common deps: curl, openssl, tar, sed, ca-certificates, gnupg, sudo.
#   3.  Install Docker + docker-compose-plugin; enable on boot.
#   4.  Install Node.js 20 + npm, then @anthropic-ai/claude-code globally.
#   5.  Clean up any stale host-nginx openclaw-managed config for $HOSTNAME.
#   6.  Fetch install.sh + nginx templates from raw.githubusercontent.com at
#       the pinned ref (branch, tag, or SHA — default: main).
#   7.  exec install.sh with all env vars passed through.
#
# Idempotent — safe to re-run.

set -euo pipefail

: "${HOSTNAME:?HOSTNAME env var is required (e.g. chat.example.com)}"
: "${ALLOWED_EMAIL:?ALLOWED_EMAIL env var is required (single authorized user email)}"
: "${INSTALLER_REPO:=pejovicvuk/claw-ops-chat}"
: "${INSTALLER_REF:=main}"
: "${INSTALLER_WORK_DIR:=/tmp/claw-chat-install}"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

step() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { printf '!! %s\n' "$*" >&2; exit 1; }

# ── Detect package manager ─────────────────────────────────────────────
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "/etc/os-release not found — unsupported distro"
fi

case "${ID:-}:${ID_LIKE:-}" in
  *debian*|ubuntu*|*ubuntu*) PKG=apt ;;
  *rhel*|*fedora*|centos*|rocky*|almalinux*) PKG=yum ;;
  *) die "Unsupported distro: ID=$ID ID_LIKE=${ID_LIKE:-}" ;;
esac

step "claw-chat bootstrap — host=$HOSTNAME ref=$INSTALLER_REF pkg=$PKG"

# ── 1. OS update ───────────────────────────────────────────────────────
step "Updating OS packages"
if [ "$PKG" = apt ]; then
  apt-get update -qy
  apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade -qy
else
  yum -q -y update
fi

# ── 2. Common deps ─────────────────────────────────────────────────────
step "Installing common dependencies"
if [ "$PKG" = apt ]; then
  apt-get install -qy curl ca-certificates openssl tar sed coreutils sudo gnupg
else
  yum -q -y install curl ca-certificates openssl tar sed coreutils sudo gnupg2
fi

# ── 3. Docker + compose plugin ─────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  step "Installing Docker via get.docker.com"
  curl -fsSL https://get.docker.com | sh
else
  step "Docker already present: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  step "Installing docker-compose-plugin"
  if [ "$PKG" = apt ]; then
    apt-get install -qy docker-compose-plugin
  else
    yum -q -y install docker-compose-plugin
  fi
fi

systemctl enable --now docker >/dev/null 2>&1 || warn "Could not enable docker service (non-systemd host?)"

docker --version
docker compose version

# ── 4. Node.js 20 + Claude CLI ─────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  step "Installing Node.js 20 (NodeSource)"
  if [ "$PKG" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -qy nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum -q -y install nodejs
  fi
else
  step "Node already present: $(node --version)"
fi

if ! command -v claude >/dev/null 2>&1; then
  step "Installing @anthropic-ai/claude-code globally"
  npm install -g --silent @anthropic-ai/claude-code
else
  step "Claude CLI already present: $(claude --version 2>/dev/null || echo '(version unknown)')"
fi

# Ensure /root/.claude exists so the compose volume mount always has a dir to bind.
mkdir -p /root/.claude

# ── 5. Nginx collision cleanup ─────────────────────────────────────────
# If host nginx has an openclaw-managed config for $HOSTNAME left over from a
# previous SSL-first workflow, remove it so the sidecar claw-nginx can own 80/443.
# install.sh itself will then stop + disable host nginx.
MANAGED_CONF="/etc/nginx/openclaw-managed/${HOSTNAME}.conf"
if [ -f "$MANAGED_CONF" ]; then
  step "Removing stale host-nginx config for $HOSTNAME"
  rm -f "$MANAGED_CONF"
  nginx -s reload 2>/dev/null || true
fi

# Abort early if port 80 is held by a non-nginx, non-docker-proxy process —
# that means something else (traefik, caddy, a bespoke daemon) owns ingress
# and we would break it. docker-proxy is fine (that's us on re-runs).
if command -v ss >/dev/null 2>&1; then
  PORT80_HOLDER="$(ss -lntpH 'sport = :80' 2>/dev/null | awk '{print $NF}' | grep -oE 'users:\(\("[^"]+"' | head -n1 | sed 's/.*"\([^"]*\)".*/\1/')"
  case "${PORT80_HOLDER:-}" in
    ''|nginx|docker-proxy|claw-nginx) ;;
    *) die "Port 80 is held by '$PORT80_HOLDER' — refusing to clobber it. Stop it first." ;;
  esac
fi

# ── 6. Fetch installer files from raw.githubusercontent.com ────────────
# No GitHub Release required — we pull install.sh and the two nginx templates
# directly from the repo at $INSTALLER_REF (default: main). Pin to a tag or
# commit SHA if you want reproducibility.
BASE_URL="https://raw.githubusercontent.com/${INSTALLER_REPO}/${INSTALLER_REF}/prod-example"

step "Fetching installer files from $BASE_URL"
rm -rf "$INSTALLER_WORK_DIR"
mkdir -p "$INSTALLER_WORK_DIR/nginx"

curl -fsSL "$BASE_URL/install.sh"              -o "$INSTALLER_WORK_DIR/install.sh"
curl -fsSL "$BASE_URL/nginx/http-only.conf"    -o "$INSTALLER_WORK_DIR/nginx/http-only.conf"
curl -fsSL "$BASE_URL/nginx/https.conf"        -o "$INSTALLER_WORK_DIR/nginx/https.conf"
chmod +x "$INSTALLER_WORK_DIR/install.sh"

# ── 7. Hand off to install.sh ──────────────────────────────────────────
step "Handing off to install.sh"
cd "$INSTALLER_WORK_DIR"
exec bash "$INSTALLER_WORK_DIR/install.sh"
