# Local Tailscale Access — Design

> Status: v0.1 draft
> Date: 2026-07-08
> Scope: expose the **local-web** dev UI (`pnpm run dev`) to your own devices over a
> **private Tailscale tailnet**. Implements `design.md` §5.1 (Local Same-Network Mode).
> Audience: single user, multiple personal devices. No public exposure, no sharing.

---

## 1. Decision

Use **`tailscale serve`** to publish the existing local-web dev server to your
private tailnet over HTTPS. Do **not** add Caddy, a relay server, GitHub OAuth,
or Docker — none of them are needed for the local UI.

This is deliberately different from `mobile-testing.md`, which targets the heavy
**remote/cloud** shape (`pnpm remote:dev` + remote-web + relay `:8082` + per-dev
GitHub OAuth + Caddy reverse proxy, four terminals). For "open the UI I already
run locally, on my phone", that stack is overkill.

The whole point: `tailscale serve` already provides the two hard parts
(stable DNS via MagicDNS + trusted HTTPS certs), and local-web is already a
**single externally-facing port** that proxies everything else. So the transport
is essentially free.

---

## 2. Why this is nearly zero-config (the two facts that matter)

**Fact 1 — local-web is single-port.** The Vite dev server (`FRONTEND_PORT`)
proxies `/api` — including WebSockets — to the backend (`BACKEND_PORT`):

```ts
// packages/local-web/vite.config.ts:134-142
proxy: {
  '/api': {
    target: `http://localhost:${process.env.BACKEND_PORT || '3001'}`,
    changeOrigin: false, // keep the browser-facing Host header
    ws: true,
  },
}
```

So `tailscale serve` only has to expose **one** port (Vite). The backend never
needs to be reachable from the tailnet at all — it stays on `localhost`.

**Fact 2 — the backend origin guard has a same-origin short-circuit.** The guard
(`crates/server/src/middleware/origin.rs`) allows a request when its `Origin`
matches its `Host` header, before ever consulting the allowlist:

```rust
// origin.rs:59 — allowed with no allowlist entry when Origin == Host
if host.is_some_and(|host| origin_matches_host(origin, host)) {
    return Ok(());
}
```

Because Vite proxies with `changeOrigin: false` (and `tailscale serve` passes the
`Host` through), a browser hitting `https://<host>.ts.net` sends
`Origin: https://<host>.ts.net` **and** `Host: <host>.ts.net` all the way to the
backend → they match → the guard passes **without touching `VK_ALLOWED_ORIGINS`**.

**Net effect:** the only change the app needs is teaching Vite to accept the
tailnet hostname. Everything else already works.

---

## 3. Architecture

```
Your device (phone / tablet / laptop, signed into the same Tailscale account)
   │  https://<your-host>.ts.net           MagicDNS name + auto Let's Encrypt cert
   ▼
tailscale serve            (runs on the dev machine, listens on tailnet :443)
   │  → http://127.0.0.1:<FRONTEND_PORT>
   ▼
Vite dev server            (local-web; allowedHosts must include .ts.net)
   │  /api  (HTTP + WebSocket)  ──proxy, changeOrigin:false──►  127.0.0.1:<BACKEND_PORT>
   ▼
Local backend              (bound to localhost only; never exposed directly)
```

- Ports come from `.dev-ports.json` (allocated by `scripts/setup-dev-environment.js`;
  frontend from 3000, backend = frontend+1). Read the frontend port with
  `node scripts/setup-dev-environment.js frontend`.
- Only the dev machine runs `tailscale serve`. Client devices just need the
  Tailscale app connected to the same account.

---

## 4. Required change (one line) + fallback

### 4.1 Required: allow the tailnet host in Vite

Vite already keeps an `allowedHosts` allowlist and already whitelists Cloudflare
tunnels — add Tailscale the same way:

```ts
// packages/local-web/vite.config.ts:147
allowedHosts: [
  '.trycloudflare.com', // existing: cloudflared tunnels
  '.ts.net',            // add: any Tailscale MagicDNS host
],
```

`.ts.net` matches every host in your tailnet, so it keeps working if the machine
name changes. (If you prefer to be strict, list the exact
`<host>.<tailnet>.ts.net` instead.)

### 4.2 Fallback (usually NOT needed): backend origin allowlist

If a request ever returns **403** from the backend (i.e. the same-origin
short-circuit didn't apply — e.g. a Tailscale/serve version that rewrites `Host`,
or a different reverse proxy), add the tailnet origin to the guard's allowlist:

```bash
# only if needed — most setups pass via the same-origin short-circuit
VK_ALLOWED_ORIGINS="http://localhost:<FRONTEND_PORT>,https://<host>.ts.net"
```

`VK_ALLOWED_ORIGINS` is comma-separated and compared by scheme+host+port
(`origin.rs:139-151`). The dev script currently sets only the localhost value.

### 4.3 Host binding — nothing to change

The backend and Vite both stay on `localhost`. `tailscale serve` connects to
`127.0.0.1:<FRONTEND_PORT>` locally, so **do not** bind either service to
`0.0.0.0`. Keeping them loopback-only is the main security property of this design.

---

## 5. Setup (Windows-first; macOS/Linux identical except install)

One-time:

1. Install Tailscale on the **dev machine** and on each **client device**
   (phone/tablet). Sign every device into the **same account**.
2. In the admin console (https://login.tailscale.com/admin/dns): enable
   **MagicDNS** and **HTTPS Certificates** (same as `mobile-testing.md` §5).
3. Apply the Vite `allowedHosts` change (§4.1).

Each session:

4. Start the app as usual: `pnpm run dev` (backend + local-web).
5. Publish Vite to the tailnet (find the port first):

   ```powershell
   # PowerShell — get the frontend port, then serve it
   node scripts/setup-dev-environment.js frontend        # e.g. 3000
   tailscale serve --bg <FRONTEND_PORT>
   tailscale serve status                                # shows https://<host>.ts.net
   ```

   `--bg` runs it in the background; it persists until you reset it.
6. On the client device: open the Tailscale app (toggle ON), browse to
   `https://<your-host>.ts.net`. Done.

Teardown when finished:

```powershell
tailscale serve reset      # stop publishing
```

---

## 6. Security model

- **No public exposure.** `tailscale serve` (not `funnel`) is visible only inside
  your tailnet. Only devices signed into your account can reach it.
- **Backend never faces the network.** Backend + Vite are loopback-only; the
  tailnet sees only what `tailscale serve` forwards.
- **HTTPS end-to-end into the tailnet.** Real Let's Encrypt certs via Tailscale;
  no self-signed cert to install on the phone.
- **App-level guards still apply.** The origin guard runs unchanged; the
  same-origin short-circuit is a legitimate same-origin request, not a bypass.
- **Trust boundary = your Tailscale account.** Anyone you add to the tailnet (or
  any compromised enrolled device) can reach the UI. For a solo user this is the
  intended, minimal boundary.

---

## 7. Trade-offs & limitations

- **This serves the dev build.** Vite dev server (not a production build), so
  it inherits dev-mode behavior and source maps. Acceptable for a private,
  self-only tailnet; do not use this shape to serve untrusted users.
- **HMR over HTTPS may need a nudge.** Vite's hot-reload WebSocket runs over the
  tailnet `wss://`. If HMR doesn't connect on a device, set `server.hmr`
  (e.g. `clientPort: 443`) — not required just to *view* the UI, only for live
  editing from the remote device.
- **Certs renew on a 90-day cycle.** Tailscale handles renewal; no action for
  the `serve` path.
- **One machine at a time.** This publishes the tailnet host's `:443`. Running it
  for two different local apps needs distinct serve paths/ports.

---

## 8. Comparison with existing options

| | This design (local + serve) | `mobile-testing.md` (remote + Caddy) | Paired relay / cloud.vibekanban.com |
|---|---|---|---|
| Target UI | local-web (`pnpm run dev`) | remote-web (`pnpm remote:dev`) | remote-web |
| Extra infra | none (Tailscale only) | Caddy + Docker + relay + OAuth | relay stack + pairing |
| Terminals | 2 (`dev`, `serve`) | 2–4 | n/a |
| Reverse proxy | `tailscale serve` (built-in) | Caddy | relay tunnel |
| Public internet | no | no (tailnet) | yes (via relay) |
| Code changes | 1 line (`allowedHosts`) | none (already documented) | none |
| Best for | "my phone, my UI, private" | testing the remote frontend | sharing / outside access |

---

## 9. Future / out of scope

- **Sharing with others → Tailscale Funnel.** Swap `serve` for `funnel` to expose
  on the public internet. That removes the tailnet trust boundary, so it MUST be
  paired with an auth boundary in front of the app (see `design.md` §7). Out of
  scope here (this doc is self-only).
- **A one-command wrapper.** A `pnpm run share` script could read the frontend
  port and run `tailscale serve` automatically. Deferred — this doc is design-only.
- **Non-Tailscale reverse proxies** (Cloudflare Tunnel already whitelisted;
  nginx/Caddy) follow the same rule: keep `Host` intact for the origin
  short-circuit, or add the origin to `VK_ALLOWED_ORIGINS`.

---

## 10. References in this repo

- `docs/ai-mobile/design.md` §5.1 (Local Same-Network Mode), §7 (Security), §8 (Tooling)
- `mobile-testing.md` (the heavier remote/Caddy path this replaces for local use)
- `packages/local-web/vite.config.ts:132-150` (proxy + `allowedHosts`)
- `crates/server/src/middleware/origin.rs` (origin guard + same-origin short-circuit)
- `scripts/setup-dev-environment.js` (port allocation, `.dev-ports.json`)
