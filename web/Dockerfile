# Web image: Vite build (VITE_API_URL is baked in at build time) served by nginx.
# Built from the repo root (docker-compose.yml: context ., dockerfile web/Dockerfile), because the app
# imports ../pkg, the code it shares with the API (tablecore, telemetry).
FROM oven/bun:1 AS build
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
COPY pkg /app/pkg
ARG VITE_API_URL=https://localhost:3333
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 443
