# One container serves the API, the SSE stream and the built web app.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gridcast/web build

FROM base AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data/logs /data/cache /data/recordings
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@gridcast/server", "start"]
