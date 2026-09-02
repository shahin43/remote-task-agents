# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig*.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY platform-skills ./platform-skills
COPY agents ./agents
COPY fixtures ./fixtures
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && npm run build:web \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && mkdir -p /app/runs \
  && chown -R app:app /app
COPY --from=build --chown=app:app /app /app
USER app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="remote-sandbox-agents"

FROM runtime-base AS remote-agent-api
LABEL org.opencontainers.image.title="remote-agent-api"
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REMOTE_AGENT_API_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/scheduler/dist/index.js"]
CMD ["--role", "api"]

FROM runtime-base AS remote-agent-control
LABEL org.opencontainers.image.title="remote-agent-control"
ENV REMOTE_AGENT_HEALTH_PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REMOTE_AGENT_HEALTH_PORT||8081)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/scheduler/dist/index.js"]
CMD ["--role", "control"]

FROM runtime-base AS remote-agent-worker
LABEL org.opencontainers.image.title="remote-agent-worker"
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends tar \
  && rm -rf /var/lib/apt/lists/*
USER app
ENV REMOTE_AGENT_HEALTH_PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REMOTE_AGENT_HEALTH_PORT||8081)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/scheduler/dist/index.js"]
CMD ["--role", "worker"]

FROM remote-agent-worker AS remote-agent-worker-docker
LABEL org.opencontainers.image.title="remote-agent-worker-docker"
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*
USER app

FROM runtime-base AS remote-agent-reconciler
LABEL org.opencontainers.image.title="remote-agent-reconciler"
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*
USER app
ENV REMOTE_AGENT_HEALTH_PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REMOTE_AGENT_HEALTH_PORT||8081)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/scheduler/dist/index.js"]
CMD ["--role", "reconciler"]
