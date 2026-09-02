# Pi agent guest image — the sandbox container that runs the in-guest Pi loop.
# Not the --role worker drain process. remote guest hooks land in a later slice.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY pi-runner.bundle.cjs /opt/worker/pi-runner.bundle.cjs

RUN mkdir -p /workspace /opt/worker \
  && chown -R node:node /workspace /opt/worker

WORKDIR /workspace
USER node

# DockerSandboxProvider overrides CMD with `sleep infinity` so exec stays available.
CMD ["sleep", "infinity"]
