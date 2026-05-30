# Operation Öland sync server. Node 20 (Debian slim — better-sqlite3's native
# build is far happier on glibc than musl), persists state to /app/data which
# the compose file mounts as a volume.

FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Build toolchain for better-sqlite3's native module.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    DB_PATH=/app/data/state.db

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
