# AI Mobile Remote Access Design

> Status: v0.1 draft
> Date: 2026-07-06
> Scope: mobile web/PWA and remote access design for easy-vibe-kanban.

## 1. Decision

The first version should be a mobile-friendly web/PWA experience, not a native
iOS/Android app.

This project is already web-first:

- Local UI: `packages/local-web`
- Remote UI: `packages/remote-web`
- Shared product surface: `packages/web-core`
- Existing remote access path: `docs/remote-access.mdx`
- Existing relay and remote transport code: `crates/relay-*`,
  `crates/ws-bridge`, `packages/remote-web/src/shared/lib/relayHostApi.ts`

The mobile product should therefore be "Vibe Kanban on mobile", not "a phone
terminal for coding". The core value is to monitor tasks, review agent output,
approve actions, inspect diffs, and send follow-up instructions while the host
machine keeps running the real workspace.

Native app packaging should stay out of the MVP unless we later prove that web
push, camera pairing, background behavior, or OS integration cannot meet the
product requirements.

## 2. Product Positioning

AI Mobile is an operational control surface for asynchronous coding agents.

It should optimize for:

- Checking board and workspace status from a phone.
- Reading latest agent output.
- Sending short follow-up messages.
- Approving or denying permission requests.
- Reviewing compact diffs and logs.
- Retrying, stopping, resuming, or creating attempts.
- Switching between hosts when the user has paired multiple machines.

It should not optimize for:

- Editing code on the phone.
- Recreating a mobile terminal.
- Streaming a full desktop IDE.
- Duplicating Happy, Claude Code Remote Control, or other CLI remote-control
  products.
- Adding a native app release pipeline before the web path is exhausted.

## 3. Current Project Baseline

### 3.1 Existing Remote Access

`docs/remote-access.mdx` already describes a remote access flow:

1. Start Vibe Kanban on the host device.
2. Generate a pairing code in Settings > Remote Access.
3. Open `cloud.vibekanban.com` on the client device.
4. Link the host with the pairing code.
5. Access host workspaces from the phone browser.

This means the product already has the shape of a mobile web remote access
solution. The main missing work is product polish, mobile layout quality, and a
better pairing story.

### 3.2 Existing Relay Stack

The repo already contains relay building blocks:

- `crates/relay-client`: host/client relay API, SPAKE2 enrollment, signing
  session refresh, signed HTTP and WebSocket forwarding.
- `crates/relay-control`, `crates/relay-protocol`, `crates/relay-ws`,
  `crates/relay-types`: relay protocol and signing primitives.
- `crates/relay-tunnel-core`: WebSocket control channel with yamux streams for
  HTTP and WebSocket proxying.
- `packages/remote-web/src/shared/lib/relayHostApi.ts`: browser-side local API
  access through relay host sessions.
- `packages/remote-web/src/shared/lib/webrtc/transport.ts`: WebRTC data channel
  transport with relay fallback for remote local API requests.

So the design should reuse the existing transport boundary instead of inventing
a new app-specific relay.

### 3.3 Existing Mobile Research

There is already an earlier draft under `docs/future/ai-mobile/`. This document
is a current decision record that narrows the first version after reviewing
MindFS and Happy.

## 4. Competitor Lessons

### 4.1 MindFS

Observed architecture:

- Local Go service serves the web UI, REST API, and WebSocket API.
- Mobile largely reuses the same web/PWA surface. Android/Harmony builds set
  `VITE_APP_SHELL=1` and package the same web assets; Capacitor mainly adds a
  shell, safe-area/native bridge handling, and background reply polling.
- Remote access is exposed through a relay tunnel. The local service dials out
  to the relay, wraps the WebSocket as a connection, multiplexes streams with
  yamux, and proxies traffic back to the local HTTP/WS server.
- The relay client can also expose configured local services, but the source
  only allows `http`/`https` URLs whose host is `localhost`, `127.0.0.1`, or
  `::1`.
- Public relay server source was not found during review.
- Optional E2EE exists. When enabled, HTTP/WS requests need a proof and WS
  payloads are decrypted before request handling.

Useful lesson:

- Reusing the web UI is the right default.
- A reverse tunnel can make "phone opens my home workstation UI" simple.
- Native shells should be treated as product polish for notifications,
  background polling, safe areas, and installability, not as a replacement for
  the web product.

Risk to avoid:

- A generic tunnel exposes a broad local API surface unless access control is
  very strict.
- Depending on an opaque relay server creates trust and operability concerns.
- Tunnel-level forwarding is simple, but product-level actions are harder to
  audit than explicit signed API/RPC calls.
- If a tunnel exposes more than the product API, every exposed service needs a
  narrow allowlist and explicit user intent.

### 4.2 Happy

Observed architecture:

- Happy has a server component, app/client component, CLI/daemon, and wire
  protocol.
- Mobile does not directly connect to the home computer. It talks to Happy's
  server over Socket.IO and HTTP APIs.
- Session messages and RPC calls are encrypted and routed through server-side
  session, machine, and user scopes.
- The server source exists and can be self-hosted.

Useful lesson:

- Business-level message/RPC routing is cleaner for multi-device coordination.
- Encrypted persisted messages improve session recovery.
- Explicit session and machine scopes are easier to audit than a broad tunnel.

Risk to avoid:

- A native app plus server protocol would duplicate a lot of product surface
  that this project already has in the web app.
- If Vibe Kanban became just a backend for a mobile CLI controller, it would
  lose its board/workflow product value.

### 4.3 Design Takeaway

Use the MindFS lesson for UI reuse, and the Happy lesson for explicit,
auditable product actions.

For this project, the preferred shape is:

```
Phone browser/PWA
  -> remote-web mobile routes
  -> existing signed relay / WebRTC transport
  -> host local backend APIs
  -> tasks, sessions, workspaces, git, executors
```

Do not build a new native app or a new opaque relay in the first version.

## 5. Target Architecture

### 5.1 Local Same-Network Mode

```
Phone browser
  -> https://host-or-lan-url
  -> local-web / local backend
```

Use this for LAN, Tailscale, Cloudflare Tunnel, reverse proxy, or any deployment
where the user intentionally exposes the local web app behind HTTPS.

Requirements:

- The UI must be responsive at mobile widths.
- The app must not assume mouse hover or desktop keyboard shortcuts.
- WebSocket and streaming endpoints must work behind the chosen proxy.
- Permission approvals must stay explicit and visible.

### 5.2 Remote Paired-Host Mode

```
Phone browser/PWA
  -> remote-web
  -> remote session / relay backend
  -> paired host relay client
  -> local backend
```

This should be the canonical "I started Vibe Kanban at home and opened it from
outside" path.

Phase 1 can keep the existing pairing-code flow. Phase 2 should improve it with
QR pairing.

### 5.3 QR Pairing Proposal

Desktop host shows a QR code containing a short-lived pairing payload:

```text
vibekanban://pair?host=<host_id>&code=<one_time_token>&relay=<relay_url>&expires=<unix_ts>
```

Payload rules:

- `code` is one-time use and short-lived.
- `relay` points to the selected public or self-hosted relay endpoint.
- The payload must be signed or validated server-side.
- Manual pairing code remains available as fallback.

Mobile behavior:

- Open the PWA.
- Scan QR with `getUserMedia` plus a browser QR decoder.
- Complete the existing relay enrollment/session flow.
- Land directly on the host workspace list.

## 6. UX Design Principles

The mobile UI should be a dense operational tool, not a marketing page.

### 6.1 Navigation

- Single-column board on phones.
- Column switcher or segmented control for task state.
- Host/project/workspace switcher in a drawer or compact top control.
- Bottom actions only for high-frequency commands.
- Keep global settings secondary.

### 6.2 Workspace Detail

Use tabs or segmented controls:

- Chat
- Diff
- Logs
- Files
- Git

Phone layout should avoid three-column desktop panels. The primary task screen
should show the active agent/chat first, with fast access to diff and logs.

### 6.3 Composer and Approvals

- Sticky composer above the mobile keyboard.
- Permission approval banner fixed near the bottom of the visible screen.
- Approve, deny, stop, retry, and resume actions must be thumb-reachable.
- Dangerous operations must show the command/path and require explicit action.

### 6.4 Diff and Logs

- Unified diff by default on mobile.
- Optional line wrap toggle.
- Collapsible hunks.
- File list first, then selected file diff.
- Logs should support compact streaming, search, and severity filtering.

## 7. Security Model

Minimum requirements:

- Use HTTPS/WSS for remote access.
- Do not expose the local backend directly to the public internet without an
  authentication boundary.
- Keep pairing credentials short-lived.
- Keep relay requests signed.
- Keep WebSocket frames signed or session-bound where relay transport is used.
- Record permission approvals in an auditable task/session history.
- Do not make mobile approval weaker than desktop approval.
- For self-hosting, document the supported boundary clearly: trusted VPN,
  HTTPS reverse proxy, or the project's relay stack.

The design should prefer product-level authorization over unrestricted tunnel
access. If a generic tunnel is used, it must still terminate into the existing
authenticated local web/backend surface.

## 8. Remote Access Tooling Guidance

For users running Vibe Kanban at home, recommended options are:

1. Existing paired-host Remote Access through the project's remote/relay stack.
2. Tailscale or another trusted mesh VPN for private direct access.
3. Cloudflare Tunnel or another HTTPS reverse proxy for users who understand the
   security boundary.
4. Self-hosted relay when the project provides a stable deployment path.

Avoid recommending:

- Exposing the local backend port directly to the public internet.
- Depending on an unknown third-party relay for private workspaces.
- Building a separate native app relay before the web/PWA path is proven.

## 9. Implementation Phases

### M0: Design and Audit

- Create this design record.
- Audit current mobile behavior for local-web, remote-web, and web-core.
- List layout breakpoints, dialogs, tables, diff/log surfaces, and approval
  flows that fail on 390px width.

### M1: Mobile Web MVP

- Make core routes usable on phone:
  - host/workspace list
  - board
  - task/session detail
  - chat/follow-up
  - approvals
  - diff/log read-only views
- Share components through `packages/web-core` where local and remote need the
  same behavior.
- Validate on iPhone Safari and Android Chrome.

### M2: Remote Access Polish

- Keep current pairing-code flow working.
- Add QR pairing if the backend/relay enrollment model supports it cleanly.
- Make host switching and remote session errors understandable on mobile.
- Document self-hosted access choices.

### M3: PWA Polish

- Confirm manifest and installability.
- Add service worker behavior only if it has a clear product use.
- Evaluate Web Push for agent completion, failure, and approval-needed events.
- Add Telegram/Discord webhook notification only if Web Push is not enough.

### M4: Native Shell Evaluation

Only evaluate native packaging if at least one of these becomes a hard
requirement:

- Reliable push notifications beyond PWA capability.
- Background execution or background sync.
- OS-level share sheet integration.
- Native credential storage requirements.
- Camera pairing that cannot be acceptable in mobile browsers.

## 10. Acceptance Criteria

The MVP is acceptable when:

- A phone user can open the app and navigate without horizontal page overflow.
- A phone user can inspect current tasks and agent status.
- A phone user can send a follow-up message to an existing session.
- A phone user can approve or deny a pending permission request.
- A phone user can read a diff and recent logs without desktop layout leakage.
- Remote paired-host access works from a mobile browser.
- The MVP does not require installing an iOS or Android app.

## 11. Open Questions

- Should QR pairing be part of M1, or should M1 only harden current pairing-code
  remote access?
- Which route should be canonical for mobile: responsive root routes, `/m`, or
  a dedicated mobile entry that reuses web-core components?
- Should self-hosted relay be the default long-term path, or remain advanced
  configuration?
- Which notification channel matters first: Web Push, Telegram, Discord, email,
  or no push in MVP?
- Which mobile surfaces are mandatory for first release: board, session chat,
  approvals, diff, logs, files, git, workflow runs?

## 12. References in This Repo

- `docs/remote-access.mdx`
- `docs/future/ai-mobile/spec-draft.md`
- `docs/future/ai-mobile/research-2026-05-21-mobile-solutions-landscape.md`
- `docs/daily-radar/.cache/a9gent__mindfs/server/internal/relay`
- `docs/daily-radar/.cache/a9gent__mindfs/web/src/services/base.ts`
- `docs/daily-radar/.cache/a9gent__mindfs/web/src/layout/AppShell.tsx`
- `docs/daily-radar/.cache/a9gent__mindfs/android/capacitor.config.ts`
- `packages/local-web`
- `packages/remote-web`
- `packages/web-core`
- `packages/remote-web/src/shared/lib/relayHostApi.ts`
- `packages/remote-web/src/shared/lib/webrtc/transport.ts`
- `crates/relay-client`
- `crates/relay-tunnel-core`
- `crates/ws-bridge`
