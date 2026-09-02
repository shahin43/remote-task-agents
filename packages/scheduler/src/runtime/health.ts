import http from 'node:http';

export interface HealthState {
  ready: boolean;
  live: boolean;
  detail?: Record<string, unknown>;
}

export interface HealthServerHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * Tiny internal health listener for non-API roles. API keeps `/api/health`.
 */
export function startHealthServer(
  check: () => Promise<HealthState> | HealthState,
  opts?: { port?: number; host?: string },
): Promise<HealthServerHandle> {
  const port = opts?.port ?? 0;
  const host = opts?.host ?? '127.0.0.1';
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const state = await check();
      if (url.pathname === '/live' || url.pathname === '/health/live') {
        response.writeHead(state.live ? 200 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ live: state.live }));
        return;
      }
      if (url.pathname === '/ready' || url.pathname === '/health/ready' || url.pathname === '/health') {
        response.writeHead(state.ready ? 200 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ready: state.ready, ...(state.detail ?? {}) }));
        return;
      }
      response.writeHead(404);
      response.end();
    })();
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: bound,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
