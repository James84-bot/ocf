# Unity Shelf: the whole library (API + website) in one container.
#   docker compose up -d         (see docker-compose.yml and README.md)

FROM node:20-bookworm-slim AS deps
WORKDIR /app/backend
# better-sqlite3 ships prebuilt binaries; the toolchain is only a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/unity_shelf.db \
    SERVE_FRONTEND=true
COPY --from=deps /app/backend/node_modules backend/node_modules
COPY backend/ backend/
COPY frontend/ frontend/
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/server.js"]
