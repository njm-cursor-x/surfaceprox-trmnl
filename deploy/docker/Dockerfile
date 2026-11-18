# syntax=docker/dockerfile:1
# Multi-arch (linux/amd64, linux/arm64). The build output is plain JS, so the build
# stage runs on the builder's native platform and only the runtime stage is per-arch.

FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && node scripts/stage.mjs /out

FROM node:24-slim
ENV NODE_ENV=production \
    SLATE_DATA_DIR=/data \
    SLATE_PORT=8787 \
    SLATE_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.SLATE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/slate.mjs"]
