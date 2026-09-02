import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The board SPA talks to the scheduler `--role api` server. In dev, Vite proxies
// `/api` to that server (default REMOTE_AGENT_API_PORT=8787). In production the
// built `dist/` is served by the same api server, so requests are same-origin.
const apiTarget = process.env.REMOTE_AGENT_API_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  // Served by the api role under /app (legacy operator dashboard keeps /).
  base: "/app/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
