# ── Stage 1: Install dependencies ──
FROM node:24-alpine AS deps
WORKDIR /app
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

# Runtime deps for Bitbucket skill (bash, curl, python3)
RUN apk add --no-cache bash curl python3

# Copy the full app with node_modules and build output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json

# Create Claude config directory (credentials mounted at runtime)
RUN mkdir -p /root/.claude

EXPOSE ${PORT}

CMD ["node", "server.js"]
