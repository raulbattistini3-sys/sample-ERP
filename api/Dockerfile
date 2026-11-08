# API image: installs with bun (api/bun.lock) and builds with tsc, runs dist/ on node.
# Built from the repo root (docker-compose.yml: context ., dockerfile api/Dockerfile), because the API
# imports ../pkg, the code it shares with the web (tablecore, telemetry).
FROM oven/bun:1 AS deps
WORKDIR /app/api
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY api/tsconfig.json ./
COPY api/src ./src
COPY pkg /app/pkg
# rootDir is the repo root, so the entry lands at dist/api/src/index.js and pkg at dist/pkg
RUN bun run build

# one-shot: applies the api/drizzle migrations the database hasn't seen (compose's "migrate" service);
# deps has drizzle-kit, which the production image leaves out
FROM deps AS migrate
COPY api/drizzle.config.ts ./
COPY api/src/configs/database_connection.ts ./src/configs/
COPY api/drizzle ./drizzle
CMD ["bun", "run", "db:migrate"]

FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
# The database CA is not baked in: API_ENV=production reads it from DATABASE_CA_CERT, a secret file the
# host mounts (e.g. /etc/secrets/prod-ca-2021.crt on Render).
USER node
EXPOSE 3333
CMD ["node", "dist/api/src/index.js"]
