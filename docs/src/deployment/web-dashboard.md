# Web Dashboard

The dashboard manages sandboxes, templates, snapshots and volumes through the existing
AgentENV API. Its Web Shell uses a real envd PTY. The frontend lives in `web/`;
the optional browser-facing mode is part of the Go gateway.

## Run against a single node

Start an AgentENV runtime first. From the repository root:

```bash
npm --prefix web ci
npm --prefix web run build
```

Use the runtime's existing API key. The gateway reads `AENV_API_KEY` or
`/run/secrets/api-key`; it does not generate a new key. Load the key through your
secret manager or a protected shell prompt, then run:

```bash
cd services
go run ./gateway/cmd -config config/dashboard.json
```

Open `http://127.0.0.1:8081` and sign in with that same key. The sample configuration
connects to `http://127.0.0.1:8000`, serves `../web/dist` relative to the gateway's
working directory, and binds both listeners to loopback. It needs no scheduler.

The optional `gateway.dashboard` object has three required fields:

| Field | Meaning |
| --- | --- |
| `upstream` | HTTP(S) origin of one runtime or an existing cluster gateway |
| `assets_dir` | Directory containing the built frontend's `index.html` |
| `public_origin` | Exact browser origin, including scheme and non-default port |

Omitting `gateway.dashboard` preserves the existing scheduler-based gateway.
In dashboard mode this process serves browser sessions and `/dashboard/api/`
routes; it does not replace the upstream gateway's SDK-facing API or scheduler.
For a cluster, set `upstream` to that existing gateway and use its API key.

## Container image

Build the frontend and Go gateway together from the repository root:

```bash
docker build -f web/Dockerfile -t agentenv-dashboard:local .
```

Mount a gateway configuration at `/etc/agentenv-dashboard/config.json` and the
runtime's existing API key at `/run/secrets/api-key`, both read-only. In that
configuration, set `http_listen_addr` to `0.0.0.0:8081`, `metrics_listen_addr` to
`127.0.0.1:19102`, `dashboard.assets_dir` to `/app/web`, `dashboard.upstream` to
the reachable runtime origin, and `dashboard.public_origin` to the browser's
HTTPS origin. Publish container port 8081 or route to it on a shared network.

The container needs no persistent data, added capabilities or Docker socket.
It supports a read-only root filesystem and dropping all capabilities. The
mounted secret must be readable by the container user; a root-owned 0600 key
requires running as root or separately provisioning a readable secret. Do not
relax the runtime's original key permissions. Sessions are in memory and users
sign in again after a restart.

## Browser sessions and HTTPS

The API key is exchanged for an opaque, in-memory, eight-hour session with an
HttpOnly, SameSite=Strict cookie. It is not saved in localStorage or sessionStorage.
Restarting the dashboard gateway invalidates sessions. This is an operator
console using the existing API key's privileges, not a separate multi-user or
RBAC system.

For remote use, put the dashboard behind HTTPS and set `public_origin` to its
public HTTPS origin. This enables Secure cookies and checks that origin for
login, mutations and WebSocket upgrades. Do not send keys over an untrusted
plaintext connection. Proxy `/dashboard/` and static resources to the same
listener; preserve WebSocket upgrades and allow long-lived connections. The
configured upstream should be reachable over a trusted network or HTTPS.

The browser cannot select an arbitrary upstream or forward guest routing
headers. The gateway exposes only the management routes used by the dashboard,
strips returned sandbox access tokens, and obtains the guest token itself when
opening a shell.

## Templates

Open **Templates** to search environments, filter build status, inspect build
history and paginated logs, or delete a template. **New template** imports an OCI
image with a name, CPU count and memory size. Private images use the runtime's
Docker credentials. Dockerfile uploads and BuildKit workflows are not exposed.

Creation registers a template and starts its build. If starting fails, **Retry
build** reuses the registered template. Builds continue in the runtime after the
page closes; details poll active builds every 2.5 seconds and display failure
reasons. Deletion conflicts are shown without removing the local entry.

Use **Launch** on a ready template, or select it as the **Starting point** in
**New sandbox**. Launches inherit the saved CPU and memory configuration. Deleting
a template prevents future launches but does not stop existing sandboxes.

## Web Shell

Open the terminal icon beside a running sandbox or use **Open Web Shell** in its
details. Resume paused sandboxes first. Each panel starts its own PTY; terminal
input, ANSI output, control characters and window resizing pass through to envd.

The gateway translates WebSocket messages to envd's ConnectRPC HTTP/1.1 protocol
using `Start`, `SendInput`, `Update` and `SendSignal`. The guest shell uses bash
when available, otherwise sh or the tools drive's BusyBox. The runtime supplies
network routing and envd authentication; no guest server changes are required.

Closing a panel, logging out, session expiration or gateway shutdown terminates
that panel's PTY. The sandbox remains running. Reopening starts a new shell;
terminal sessions are not reattached. A disconnected or paused runtime is shown
as an error rather than silently switching to simulated output.

### Known runtime limitation

In a real v0.2.3 runtime test, the Alpine guest shell inherited ignored SIGINT
(`SigIgn` included bit 2). Ctrl+C reaches the PTY but does not interrupt a
foreground command in that environment. The CLI-equivalent shell dispatcher
reproduces the same behavior; fixing it requires correcting the guest process
signal inheritance. The dashboard does not substitute a different kill signal.

## Development and demo

For frontend hot reload, run `npm --prefix web run dev`. Vite proxies
`/dashboard/` to `http://127.0.0.1:8081`. In a **local copy** of the gateway config,
set `public_origin` to the exact Vite origin you open, for example
`http://localhost:5173`. Keep the configured origin and browser URL consistent.

Append `?demo=1` to use the separate, browser-only sample workspace. Demo commands
never reach a backend. Reloading restores the samples.

Live workspace lists follow API pagination and refresh every ten seconds.
Snapshots omit the size badge when the API does not report actual storage usage;
`diskSizeMB` is provisioned capacity, not snapshot bytes. Snapshot cards support
deletion with confirmation and retain the entry when deletion fails. The current
runtime deletes snapshot records through its compatible template deletion endpoint.
Volume usage
is likewise shown as unavailable. The current UI reads volume details but does
not create or delete volumes. Newly created sandboxes auto-pause after five
minutes; resuming uses a five-minute timeout. Snapshot launches inherit their
resource configuration.

## Validate

```bash
npm --prefix web run generate:api  # after changes to src/api/openapi.yml
npm --prefix web run check
npm --prefix web test
make -C services test
make -C services fmt-check vet
(cd services && go test ./...)
(cd services && go test -race ./gateway/internal/dashboard)
```

Install Playwright's Chromium once with `cd web && npx playwright install chromium`.
Browser tests cover both demo interactions and mocked live API/WebSocket flows.
Go tests exercise real HTTP/WebSocket connections with a controlled envd protocol
fixture, including origin checks, expiry, pagination headers, input, resizing and
PTY cleanup. They do not require a VM.
