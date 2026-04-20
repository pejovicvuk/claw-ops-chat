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
RUN apk add --no-cache bash curl python3 git openssh-client jq \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/opt/uv sh \
    && ln -s /opt/uv/uv /usr/local/bin/uv \
    && ln -s /opt/uv/uvx /usr/local/bin/uvx

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

CMD ["node", "server.js"]
