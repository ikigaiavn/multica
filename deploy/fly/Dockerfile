# syntax=docker/dockerfile:1
# Single-machine image for Fly.io: Go backend + Next.js web + Caddy on one
# hostname. Build from the repository root:
#   fly deploy --config deploy/fly/fly.toml --dockerfile deploy/fly/Dockerfile

# --- Backend ---------------------------------------------------------------
FROM golang:1.26.9-alpine AS backend
RUN apk add --no-cache git
WORKDIR /src
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY server/ ./server/
ARG COMMIT=unknown
RUN cd server && CGO_ENABLED=0 go build -ldflags "-s -w -X main.commit=${COMMIT}" -o bin/server ./cmd/server
RUN cd server && CGO_ENABLED=0 go build -ldflags "-s -w" -o bin/migrate ./cmd/migrate

# --- Web dependencies --------------------------------------------------------
FROM node:22-alpine AS web-deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/views/package.json packages/views/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
# Root package.json patches a mobile dependency; pnpm checks the patch file
# even when installing only the web workspace.
COPY apps/mobile/patches/ apps/mobile/patches/
RUN corepack enable && \
    corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate
RUN pnpm install --frozen-lockfile --filter @multica/web...

# --- Web build ---------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
COPY --from=web-deps /app ./
RUN corepack enable && \
    corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate
COPY apps/web/ apps/web/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --offline --filter @multica/web...
ENV STANDALONE=true
RUN pnpm --filter @multica/web build

# --- Runtime -----------------------------------------------------------------
FROM node:22-alpine
RUN apk add --no-cache ca-certificates tzdata caddy "libcrypto3>=3.5.8-r0" "libssl3>=3.5.8-r0"
ENV NODE_ENV=production

WORKDIR /app/server
COPY --from=backend /src/server/bin/server /src/server/bin/migrate ./
COPY server/migrations/ ./migrations/

WORKDIR /app/web
COPY --from=web /app/apps/web/.next/standalone ./
COPY --from=web /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web /app/apps/web/public ./apps/web/public

COPY deploy/fly/Caddyfile /etc/caddy/Caddyfile
COPY deploy/fly/start.sh /app/start.sh
COPY LICENSE NOTICE /app/

EXPOSE 8080
CMD ["/app/start.sh"]
