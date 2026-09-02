resolve_docker() {
  for candidate in \
    "${DOCKER_BIN:-}" \
    "${REMOTE_AGENT_DOCKER_BIN:-}" \
    "/Applications/Docker.app/Contents/Resources/bin/docker" \
    "/opt/homebrew/bin/docker" \
    "docker"
  do
    if [ -n "$candidate" ] && command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "docker CLI not found" >&2
  return 1
}
