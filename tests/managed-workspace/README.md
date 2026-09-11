# Managed workspace regressions

Run from the repository root:

```sh
pnpm exec playwright test -c tests/managed-workspace/playwright.config.ts
pnpm exec playwright test -c tests/managed-workspace/general.playwright.config.ts
```

The browser renders the production `CreateChatBoxContainer`. The editor/view,
configuration hooks, directory picker, and create mutation are fixture boundaries.
The production container still owns initialization, selection precedence, request
construction, pending guards, and stale-completion handling. The mutation mock
returns render-snapshot pending state, so same-tick tests exercise the real
synchronous lock rather than a magically updated mock property.

The settings cases render the production `ManagedWorkspaceDirectoryField` with
real UI Button/Input primitives. Only the controlled draft owner, machine-state
hooks and asynchronous folder picker are replaced.

The separate General Settings suite renders the production form, save bar and
`useUserSystemController`, with an in-memory Host-owned load/save transport. It
checks rejected saves retain the draft and dirty guard, retry persists the root,
same-tick saves deduplicate, and late Host/unmount completions do not apply the
old theme or update a new form. Host discovery, theme application and dirty
context are observed fixture boundaries; disk config reload and backend root
validation remain outside this browser suite.

No actual Agent, application server, database, or working directory is touched.
These tests validate the request for backend-managed allocation, not physical
directory uniqueness, persistence, deletion ownership, or filesystem rollback.
Those require the backend regression suite in an approved build environment.
