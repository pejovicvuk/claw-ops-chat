# ── Stage 1: Install dependencies ──
FROM node:24-alpine AS deps
WORKDIR /app
# node-pty has a native addon. Alpine's musl prebuilts aren't shipped,
# so we install a build toolchain to compile it at install time.
# These packages are only present in this stage — not copied to the runner.
RUN apk add --no-cache python3 make g++ linux-headers
COPY package.json ./
RUN npm install

# ── Stage 2: Build ──
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: Production image ──
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}"

# Runtime deps: git for version control, bash/curl/python3/jq for the read-only
# Bitbucket skill, uv for Python MCP servers. jq is how bitbucket-cli.sh
# pretty-prints and filters the Bitbucket API JSON responses.
#
# `chromium` and friends (nss / freetype / harfbuzz / ttf-freefont) power
# the preview-stream subsystem: a headless Chromium tab is launched per
# active preview window, driven via Chrome DevTools Protocol, and its
# JPEG screencast frames are forwarded to the user's browser over a
# WebSocket. We point playwright-core at Alpine's prebuilt Chromium via
# PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH instead of letting Playwright
# download its own bundled browser (which doesn't ship Alpine/musl
# binaries anyway). Image grows ~400 MB compared to a Chromium-less
# image — acceptable trade-off for full server-side rendering.
RUN apk add --no-cache bash curl python3 git openssh-client jq github-cli \
    chromium nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/opt/uv sh \
    && ln -s /opt/uv/uv /usr/local/bin/uv \
    && ln -s /opt/uv/uvx /usr/local/bin/uvx

# Tell playwright-core to use the system Chromium instead of trying to
# spawn its own bundled binary (which would 404 on Alpine).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy the full app with node_modules and build output.
# server.js requires sibling JS files compiled from TS + the CJS SDK wrapper;
# all four must be present in the runner image.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
# public/ holds manifest.json, favicons, PWA icons, and the push service
# worker. Next.js standalone output does NOT copy this automatically; without
# it every static-asset request (manifest, icons) 404s.
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/sdk-loader.js ./sdk-loader.js
# In-repo MCP wrapper for the Bitbucket skill. Registered in ~/.claude.json
# by src/lib/bitbucket-custom-config.ts and spawned by the Agent SDK as a
# stdio MCP server — it shells out to /opt/skills/bitbucket/bitbucket-cli.sh.
COPY --from=builder /app/bitbucket-mcp.js ./bitbucket-mcp.js
# Ship the entire compiled lib dir, not hand-picked files. tsc follows
# server.ts's import graph and can emit new src/lib/*.js any time a new
# import lands; allowlisting specific files broke the container the
# moment bitbucket-custom-config was imported. Directory copy removes
# that footgun — ~20 small files, both .ts and .js, no meaningful bloat.
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json

# Create Claude config directory (credentials mounted at runtime)
RUN mkdir -p /root/.claude

EXPOSE ${PORT}

# --expose-gc enables the optional "Force GC" admin action in the
# Monitoring → Server Health section. It does NOT enable user-triggered
# GC over the wire — the admin route is auth-gated and audit-logged.
CMD ["node", "--expose-gc", "server.js"]
