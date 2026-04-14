#!/bin/bash
set -euo pipefail

# ============================================================================
# deploy-chat.sh — Deploy Claw Chat (Claude Code web interface)
#
# Usage: ./deploy-chat.sh
#
# Deploys the claw-chat Docker container on the current server with:
#   - Claude Code authentication (subscription-based)
#   - Caddy reverse proxy at /chat
#   - Optional Bitbucket integration
# ============================================================================

REPO_URL="https://github.com/pejovicvuk/claw-ops-chat.git"
INSTALL_DIR="/root/claw-ops-chat"
CADDY_FILE="/etc/caddy/Caddyfile"
PORT="${PORT:-3100}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}[$1/8]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         Claw Chat Deployment          ║"
echo "  ║   Claude Code Web Chat Interface      ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Step 1: Pre-flight checks ──
step 1 "Pre-flight checks"

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install it first."
docker info >/dev/null 2>&1 || fail "Docker is not running."
ok "Docker is available"

command -v git >/dev/null 2>&1 || fail "Git is not installed."
ok "Git is available"

if command -v caddy >/dev/null 2>&1; then
  ok "Caddy is available"
else
  warn "Caddy not found — you'll need to set up reverse proxy manually"
fi

# ── Step 2: Clone or update repository ──
step 2 "Setting up repository"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || warn "Could not pull latest (continuing with current version)"
  ok "Updated existing installation"
else
  git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null
  cd "$INSTALL_DIR"
  ok "Cloned repository"
fi

# ── Step 3: Claude Code authentication ──
step 3 "Checking Claude Code authentication"

if [ -f "/root/.claude/.credentials.json" ]; then
  ok "Claude Code credentials found"
else
  warn "Claude Code credentials not found at /root/.claude/.credentials.json"
  echo ""
  echo "  Claude Code needs to be authenticated on this server."
  echo "  Installing Claude Code CLI..."

  if ! command -v claude >/dev/null 2>&1; then
    npm install -g @anthropic-ai/claude-code 2>/dev/null
    ok "Claude Code CLI installed"
  fi

  echo ""
  echo -e "  ${YELLOW}Please run the following command to authenticate:${NC}"
  echo -e "  ${CYAN}claude auth login${NC}"
  echo ""
  echo "  Then re-run this script."
  exit 1
fi

# ── Step 4: Bitbucket skill ──
step 4 "Setting up Bitbucket skill"

SKILL_SRC="/root/openclaw-templates/qa/workspace/skills/bitbucket"
SKILL_DST="$INSTALL_DIR/skills/bitbucket"

mkdir -p "$SKILL_DST"

if [ -d "$SKILL_SRC" ]; then
  cp "$SKILL_SRC/bitbucket-cli.sh" "$SKILL_DST/" 2>/dev/null && chmod +x "$SKILL_DST/bitbucket-cli.sh"
  cp "$SKILL_SRC/SKILL.md" "$SKILL_DST/" 2>/dev/null
  ok "Bitbucket skill copied from templates"
elif [ -f "$SKILL_DST/bitbucket-cli.sh" ]; then
  ok "Bitbucket skill already present"
else
  warn "Bitbucket skill templates not found — skill will not be available"
fi

# ── Step 5: Environment setup ──
step 5 "Configuring environment"

if [ -f "$INSTALL_DIR/.env" ]; then
  ok "Environment file exists"
else
  echo ""

  # Chat token
  read -sp "  Enter access token for the web UI: " CHAT_TOKEN
  echo ""
  [ -z "$CHAT_TOKEN" ] && CHAT_TOKEN="$(openssl rand -hex 16)"

  # Bitbucket (optional)
  echo ""
  read -p "  Configure Bitbucket integration? (y/N): " SETUP_BB
  BB_WORKSPACE=""
  BB_TOKEN=""
  BB_EMAIL=""
  if [[ "$SETUP_BB" =~ ^[Yy] ]]; then
    read -p "  Bitbucket workspace slug: " BB_WORKSPACE
    read -sp "  Bitbucket API token: " BB_TOKEN
    echo ""
    read -p "  Atlassian email: " BB_EMAIL
  fi

  cat > "$INSTALL_DIR/.env" << EOF
CLAW_CHAT_TOKEN=$CHAT_TOKEN
PORT=$PORT
NODE_ENV=production
CLAUDE_CWD=/workspace

# Bitbucket integration
BITBUCKET_WORKSPACE=$BB_WORKSPACE
BITBUCKET_API_TOKEN=$BB_TOKEN
ATLASSIAN_EMAIL=$BB_EMAIL
EOF

  ok "Environment file created"
  echo -e "  ${YELLOW}Access token: $CHAT_TOKEN${NC}"
fi

# ── Step 6: Build Docker image ──
step 6 "Building Docker image"

cd "$INSTALL_DIR"
docker compose build --quiet 2>&1 || docker compose build
ok "Docker image built"

# ── Step 7: Configure Caddy ──
step 7 "Configuring reverse proxy"

if [ -f "$CADDY_FILE" ]; then
  if grep -q "claw-chat\|/chat\*" "$CADDY_FILE" 2>/dev/null; then
    ok "Caddy /chat route already configured"
  else
    # Find the main site block and add the /chat handler
    DOMAIN=$(grep -m1 '\.viksi\.ai {' "$CADDY_FILE" | awk '{print $1}' 2>/dev/null)
    if [ -n "$DOMAIN" ]; then
      # Insert before the closing brace of the first site block
      sed -i "/$DOMAIN {/a\\    # Claw Chat — Claude Code web interface\n    handle /chat* {\n        reverse_proxy localhost:$PORT\n    }" "$CADDY_FILE"
      caddy reload --config "$CADDY_FILE" 2>/dev/null
      ok "Added /chat route to Caddy for $DOMAIN"
    else
      warn "Could not auto-configure Caddy — add manually:"
      echo "    handle /chat* { reverse_proxy localhost:$PORT }"
    fi
  fi
else
  warn "No Caddyfile found at $CADDY_FILE — configure reverse proxy manually"
fi

# Stop pm2 if running
if command -v pm2 >/dev/null 2>&1 || command -v npx >/dev/null 2>&1; then
  npx pm2 delete claw-chat 2>/dev/null && ok "Stopped pm2 process" || true
fi

# ── Step 8: Start container ──
step 8 "Starting Claw Chat"

cd "$INSTALL_DIR"
docker compose up -d 2>&1
ok "Container started"

# Health check
echo -e "\n  Waiting for health check..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/chat/api/health" >/dev/null 2>&1; then
    echo ""
    ok "Health check passed"
    break
  fi
  sleep 2
  [ "$i" -eq 30 ] && warn "Health check timed out — check logs with: docker compose logs -f"
done

# Done
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Claw Chat is deployed!          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "  URL:    https://$(hostname -f)/chat/"
echo "  Health: curl http://localhost:$PORT/chat/api/health"
echo "  Logs:   cd $INSTALL_DIR && docker compose logs -f"
echo ""
