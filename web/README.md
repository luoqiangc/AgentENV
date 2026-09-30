# AgentENV web dashboard

React + TypeScript + Vite dashboard with TanStack Query, React Router, generated
OpenAPI types and xterm.js. The Apple-inspired UI supports both a connected
workspace and an explicit, offline demo.

## Run

Use Node.js 22.12+ and npm:

```sh
cd web
npm ci
npm run build
```

For live use, run the Go gateway in dashboard mode. See
[Web Dashboard deployment](../docs/src/deployment/web-dashboard.md) for setup,
API-key sessions, single-node/cluster upstreams and HTTPS configuration.

```sh
npm run dev          # Vite on :5173; /dashboard proxies to 127.0.0.1:8081
npm run check        # formatting, TypeScript and production build
npm test             # browser tests; starts Vite if needed
npm run generate:api # regenerate types from ../src/api/openapi.yml
```

For Vite, set the gateway's `dashboard.public_origin` to the exact Vite browser
origin. `npm run preview` serves static assets only; use the Go gateway to verify
a production build with real API routes.

For a backend-free design review open `http://localhost:5173/?demo=1`. Demo actions
and terminal commands are simulated and reset on reload. The development server
also listens on the local network; use `npm run dev -- --host 127.0.0.1` to restrict
it to localhost.

Install Chromium once with `npx playwright install chromium` if needed.

## Structure

- `src/main.tsx`, `src/styles.css`: workspace UI, navigation and visual system.
- `src/api/`: HTTP client and generated OpenAPI types.
- `src/useWorkspace.ts`: paginated live queries and separate demo state.
- `src/Login.tsx`: API-key exchange for a gateway session.
- `src/Templates.tsx`: OCI template creation, build history/logs and management.
- `src/LiveShell.tsx`: lazily loaded xterm.js WebSocket client.
- `src/WebShell.tsx`, `src/data.ts`: explicit demo-only terminal and sample data.
- `tests/`: browser tests for local interactions and mocked backend contracts.

`services/` is a separate Go module. Keeping the frontend in root-level `web/`
gives it independent dependencies, builds and browser tests without coupling it
to Go compilation. Font assets are bundled locally.
