# AI Mobile — Layout Examples (390px)

> Status: v1.0  
> Date: 2026-07-07  
> Purpose: Visual reference showing current mobile layout implementation at 390px width (iPhone 12/13/14 mini).

These ASCII mockups illustrate the **implemented** mobile layouts after G4/G5/G6/G7 changes. Each example shows:
- Component hierarchy
- Touch target zones (marked `[Button 44×44]` when critical)
- Viewport-keyboard interaction (G4)
- Tab visibility (G7)

---

## 1. App Shell — No Keyboard (Idle State)

```
┌─────────────────────────────────────┐ 390px wide
│ ☰  Vibe Kanban          [@] [⚙]    │ ← Navbar (56px)
├─────────────────────────────────────┤
│                                     │
│   ┌─ Chat Tab Content ─────────┐   │
│   │                             │   │
│   │  [Agent message bubble]     │   │
│   │  [User message bubble]      │   │
│   │                             │   │
│   │                             │   │ ← Scrollable content
│   │                             │   │   (fills available height)
│   │                             │   │
│   │                             │   │
│   └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│ ┌───────────────────────────────┐   │
│ │ Type a message...             │   │ ← Composer (auto-height)
│ └───────────────────────────────┘   │   min 56px, max 50vh
│ [📎] [🔽] [Model ▾]    [Send 44×] │ ← Footer controls
└─────────────────────────────────────┘
  ← pb-[env(safe-area-inset-bottom)]

Key measurements:
- Total height: var(--app-vh, 100dvh)  [G4 fix]
- Shell: fixed inset-x-0 top-0
- Navbar: 56px fixed top
- Composer: bottom of flex column
- Safe area: iOS notch/home indicator
```

---

## 2. App Shell — Keyboard Open (G4 Solution)

```
┌─────────────────────────────────────┐
│ ☰  Vibe Kanban          [@] [⚙]    │ ← Navbar (still visible)
├─────────────────────────────────────┤
│                                     │
│   ┌─ Chat Tab ──────────────────┐  │
│   │ [Older messages scroll up]  │  │
│   │                             │  │
│   │ [Agent: Here's the fix...]  │  │ ← Content scrolls
│   │                             │  │   naturally
│   └─────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│ ┌───────────────────────────────┐   │
│ │ How do I test this?█          │   │ ← Composer (above kbd)
│ └───────────────────────────────┘   │
│ [📎] [🔽]              [Send 44×] │ ← Footer still reachable
└─────────────────────────────────────┘
█████████████████████████████████████  ← iOS software keyboard
█  q  w  e  r  t  y  u  i  o  p    █     (visualViewport shrinks)
█   a  s  d  f  g  h  j  k  l     █
█    z  x  c  v  b  n  m    ⌫     █
█         [____space____]     ⏎   █
█████████████████████████████████████

Shell height change:
- Before G4: fixed inset-0 (100vh, keyboard covers composer)
- After G4:  height = visualViewport.height (shrinks to ~460px)
- Composer + footer stay above keyboard ✓

Implementation:
- useVisualViewportHeightVar() → --app-vh CSS var
- Shell: style={{ height: 'var(--app-vh, 100dvh)' }}
- Updates on viewport resize/scroll (keyboard triggers both)
```

---

## 3. Session View — Simplified Tabs (G7)

### Desktop (≥768px) — All Tabs
```
┌─────────────────────────────────────────────────────┐
│ [Chat] [Files] [Changes] [Logs] [Preview] [Git]    │
└─────────────────────────────────────────────────────┘
  ↑ 6 tabs visible, full labels
```

### Mobile (≤767px) — Chat Only
```
┌─────────────────────────────────────┐
│          [💬 Chat]                  │ ← Only visible tab (G7)
└─────────────────────────────────────┘
  Other panels (Files/Changes/Logs/Preview/Git) are:
  - Not shown in tab bar
  - Still mounted in WorkspacesLayout (hidden class)
  - Desktop-only for M0
```

**Rationale**: Design §6 acceptance criteria require chat + approval only. Complex panels (multi-file diff, streaming logs, git tree, preview iframe) are deferred to desktop. The chat tab gives:
- Agent message stream
- Inline approval cards (until G1/G2 add fixed banner)
- Follow-up composer
- Embedded single-file diffs (small)

**Trade-off**: The hidden panels still load data. A deeper mobile-only WorkspacesLayout that unmounts them would save memory but wasn't in M0 scope — G7 delivers the UX requirement (user can't accidentally get stuck on hidden tab) with minimal code change.

---

## 4. Approval Flow — Inline (Current, Pre-G1)

```
┌─────────────────────────────────────┐
│ ☰  Session XYZ          [@] [⚙]    │
├─────────────────────────────────────┤
│ ┌─ Chat Timeline ────────────────┐  │
│ │ Agent: I'll run npm install    │  │
│ │                                │  │
│ │ ╔═══════════════════════════╗  │  │
│ │ ║ 🔐 Permission Required    ║  │  │ ← Inline approval card
│ │ ║ Command: npm install      ║  │  │   (scrollable, not fixed)
│ │ ║ Directory: /app           ║  │  │
│ │ ║                           ║  │  │
│ │ ║ [✓ 32×] Deny reason:     ║  │  │ ← 32px targets (P1 gap)
│ │ ║ [✗ 32×] ┌─────────────┐  ║  │  │   hover-only labels
│ │ ║         │ (textarea)  │  ║  │  │
│ │ ║         └─────────────┘  ║  │  │
│ │ ╚═══════════════════════════╝  │  │
│ │                                │  │
│ │ [Earlier messages above...]    │  │ ← Approval may be
│ └────────────────────────────────┘  │   off-screen (P0 gap)
│                                     │
│ ┌───────────────────────────────┐   │
│ │ Type a message...             │   │ ← Composer (may be
│ └───────────────────────────────┘   │   under keyboard)
│ [📎] [🔽]              [Send]    │
└─────────────────────────────────────┘

P0 Gap (from audit §A1):
- User must scroll transcript to find approval
- Design §6.3 requires fixed banner near bottom
- Next: G1/G2 add bottom-anchored approval bar
```

---

## 5. Approval Flow — Planned (G1/G2 Target)

```
┌─────────────────────────────────────┐
│ ☰  Session XYZ          [@] [⚙]    │
├─────────────────────────────────────┤
│ ┌─ Chat Timeline ────────────────┐  │
│ │ Agent: I'll run npm install    │  │
│ │                                │  │
│ │ [Transcript continues...]      │  │
│ │                                │  │
│ │                                │  │ ← Scrollable content
│ │                                │  │
│ └────────────────────────────────┘  │
├─────────────────────────────────────┤
│ ╔═══════════════════════════════╗   │
│ ║ 🔐 Approval Required          ║   │ ← Fixed banner
│ ║ npm install in /app           ║   │   (always visible)
│ ║                               ║   │
│ ║ [Approve 44×44] [Deny 44×44]  ║   │ ← ≥44px targets
│ ╚═══════════════════════════════╝   │   visible labels
└─────────────────────────────────────┘
  ← Above composer, below chat scroll

Design goals (G1/G2):
- Banner fixed when hasPendingApproval=true
- ≥44px touch targets, visible labels (no hover)
- Thumb-reachable (bottom third of screen)
- Approve → execute; Deny → open reason textarea
- Inline card remains (context), banner surfaces action
```

---

## 6. Workspace List — Remote

```
┌─────────────────────────────────────┐
│ ☰  host-macbook         [@] [⚙]    │ ← Host switcher in drawer
├─────────────────────────────────────┤
│ ┌ Workspaces ─────────────────────┐ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ 📁 project-alpha            │ │ │
│ │ │ Session: fix-login-bug      │ │ │
│ │ │ Status: Running             │ │ │ ← Card (tap → detail)
│ │ │ Updated: 2m ago             │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ 📁 backend-api         🔴   │ │ │ ← Badge when
│ │ │ Session: refactor-db        │ │ │   hasPendingApproval
│ │ │ Status: Waiting Approval    │ │ │
│ │ │ Updated: 5m ago             │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ [+ New Workspace 44×44]         │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘

Already implemented:
- Single column (sm:grid-cols-2 → 1 col)
- Safe-area padding
- Pending-approval badge (red dot)
- Tap card → workspace detail (chat tab)
```

---

## 7. Mobile Drawer — Navigation

```
Tap ☰ → drawer slides in from left

┌─────────────────────────────────────┐
│ ┌─ Drawer ──────────────┐           │
│ │                       │           │
│ │ Hosts                 │           │
│ │ ───────────────────   │           │
│ │ • host-macbook    ✓   │           │ ← Active host
│ │ • host-windows        │           │
│ │                       │           │
│ │ Projects              │           │
│ │ ───────────────────   │           │
│ │ 🏠 Home               │           │
│ │ 📋 Kanban             │           │
│ │                       │           │
│ │ ⚙ Settings            │           │
│ │                       │           │
│ └───────────────────────┘           │
│           ↑ Tap outside to close    │
│           │ pb-[safe-area-inset]    │
└─────────────────────────────────────┘

Component: packages/ui/src/components/MobileDrawer.tsx
- Slide-in animation
- Overlay backdrop
- Safe-area aware
- Used by both local/remote shells
```

---

## 8. Composer States

### 8.1 Idle (No Message)
```
┌─────────────────────────────────────┐
│ ┌───────────────────────────────┐   │
│ │ Type a message...             │   │ ← Placeholder
│ └───────────────────────────────┘   │   (min-h-[56px])
│ [📎] [🔽] [Model ▾]    [Send]    │ ← Footer controls
└─────────────────────────────────────┘
  Attach  Tools  Executor   Action
```

### 8.2 Typing (Auto-Expand)
```
┌─────────────────────────────────────┐
│ ┌───────────────────────────────┐   │
│ │ Can you refactor the auth     │   │
│ │ module to use the new token   │   │ ← Grows to max-h-[50vh]
│ │ system? Make sure to update   │   │   then scrolls
│ │ the tests too.█               │   │
│ └───────────────────────────────┘   │
│ [📎] [🔽]              [Send 44×] │ ← Send activates
└─────────────────────────────────────┘
```

### 8.3 Plan Approval Mode (G4 Compliant)
```
┌─────────────────────────────────────┐
│ ┌───────────────────────────────┐   │
│ │ [Plan preview or details]     │   │ ← Read-only plan view
│ └───────────────────────────────┘   │
│ [Stop 44×] [Approve 44×] [Request  │ ← Approval actions
│             Changes 44×]            │   (footer, above kbd)
└─────────────────────────────────────┘

This approval path (A4 in audit) is G4-compliant:
- Actions in composer footer (bottom-anchored)
- ≥44px targets
- Above keyboard after G4 fix ✓

The inline tool-approval path (A1/A2) is NOT yet compliant:
- Inline card in transcript (not fixed)
- 32px approve/deny targets
- → Fixed by upcoming G1/G2
```

---

## 9. Dialog — Current Behavior (P1 Gap)

```
┌─────────────────────────────────────┐
│                                     │ ← Top of viewport (may be
│  ┌─────────────────────────────┐   │   above visible area)
│  │ [×] Create Pull Request     │   │
│  │                             │   │
│  │ Title: ________________     │   │
│  │                             │   │
│  │ Description:                │   │
│  │ ┌─────────────────────┐     │   │
│  │ │ (textarea)          │     │   │ ← Dialog content
│  │ │                     │     │   │   (no max-height,
│  │ │                     │     │   │    no scroll)
│  │ └─────────────────────┘     │   │
│  │                             │   │
│  │ Base: main ▾                │   │
│  │ Head: feature ▾             │   │
│  │                             │   │
│  │ [Cancel] [Create PR]        │   │
│  └─────────────────────────────┘   │
│                                     │ ← Bottom may be below
└─────────────────────────────────────┘   viewport (unreachable)

P1 Gap (audit §D1):
- Dialog primitive: fixed left-[50%] top-[50%]
- No max-height → tall dialogs clip off-screen
- Close button [×] may be above visible area
- Action buttons may be below visible area
- Affects: CreatePRDialog, RebaseDialog, GitActionsDialog,
          LinkPrToIssueDialog, StartReviewDialog, etc.

Exception: SettingsDialog is already mobile-friendly
          (full-screen, internal scroll, master-detail nav)
```

---

## 10. Dialog — Target Behavior

```
Option A: Constrained Dialog
┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │ ← 1rem top margin
│ │ [×] Create Pull Request         │ │
│ │─────────────────────────────────│ │
│ │ Title: ________________         │ │
│ │                                 │ │ ← Scrollable content
│ │ Description:                    │ │   max-h-[calc(100dvh-2rem)]
│ │ ┌─────────────────────────┐     │ │
│ │ │ (textarea, scrolls)     │     │ │
│ │ └─────────────────────────┘     │ │
│ │                                 │ │
│ │ Base: main ▾                    │ │
│ │─────────────────────────────────│ │
│ │ [Cancel] [Create PR]            │ │ ← Sticky footer
│ └─────────────────────────────────┘ │
│                                     │ ← 1rem bottom margin
└─────────────────────────────────────┘

Option B: Bottom Sheet (mobile only)
┌─────────────────────────────────────┐
│                                     │
│   [Backdrop, tap to dismiss]        │
│                                     │
│                                     │
├─────────────────────────────────────┤ ← Slides up from bottom
│ ┌─ Create Pull Request ──────────┐ │
│ │ ─────                           │ │ ← Handle (swipe to dismiss)
│ │                                 │ │
│ │ Title: ________________         │ │
│ │                                 │ │
│ │ (scrollable content...)         │ │
│ │                                 │ │
│ │ [Cancel] [Create PR]            │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
  pb-[safe-area-inset-bottom]

Audit recommendation: Add Option A to Dialog primitive first
(one fix, all dialogs benefit), then consider Option B for polish.
```

---

## 11. Breakpoint Behavior Summary

| Width | Shell | Navbar Tabs | Workspace Tabs | Dialog |
|-------|-------|-------------|----------------|--------|
| ≥768px (md:) | Desktop grid + sidebar | N/A (sidebar nav) | All 6 tabs (chat/files/changes/logs/preview/git) | Centered, max-w-lg/2xl |
| 481-767px | Mobile flex column | Icons+labels (6 items) | Chat only (G7) | Centered, max-w-lg |
| ≤480px | Mobile flex column | Icons only (no labels) | Chat only (G7) | Edge-to-edge, max-w-lg |
| ≤390px (target) | Mobile flex column | Icons only | Chat only | Edge-to-edge (0 margin) |

**Inconsistency Note** (from audit §2):
- `useIsMobile` = 767px max-width
- Tailwind `md:` = 768px min-width
- Navbar label visibility = 480px
- Three different thresholds coexist but mostly align (±1px). Not a blocker for M0.

---

## 12. Keyboard Interaction — Before/After G4

### Before G4 (Shell = `fixed inset-0`)
```
Keyboard closed:                Keyboard open:
┌────────────┐                 ┌────────────┐
│   Navbar   │ ← fixed         │   Navbar   │ ← fixed
├────────────┤                 ├────────────┤
│            │                 │            │
│  Content   │ ← scrolls       │  Content   │ ← scrolls
│            │                 │            │
│            │                 │  Composer  │ ← HIDDEN UNDER KBD ✗
├────────────┤                 ▓▓▓▓▓▓▓▓▓▓▓▓▓ 
│  Composer  │ ← visible       ▓ Keyboard  ▓
└────────────┘                 ▓▓▓▓▓▓▓▓▓▓▓▓▓

Shell height = 100vh (window.innerHeight)
visualViewport shrinks BUT shell doesn't react
→ Composer gets occluded (P0 blocker)
```

### After G4 (Shell = `height: var(--app-vh)`)
```
Keyboard closed:                Keyboard open:
┌────────────┐                 ┌────────────┐
│   Navbar   │                 │   Navbar   │
├────────────┤                 ├────────────┤
│            │                 │  Content   │ ← scrolled up
│  Content   │                 ├────────────┤
│            │                 │  Composer  │ ← VISIBLE ✓
├────────────┤                 └────────────┘
│  Composer  │                 ▓▓▓▓▓▓▓▓▓▓▓▓▓
└────────────┘                 ▓ Keyboard  ▓
                               ▓▓▓▓▓▓▓▓▓▓▓▓▓

Shell height = visualViewport.height
→ Shell shrinks when keyboard opens
→ Composer stays above keyboard ✓
→ Entire layout remains reachable
```

**Implementation**:
```ts
// useVisualViewportHeightVar.ts
const update = () => {
  const height = viewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
};
viewport.addEventListener('resize', update);
viewport.addEventListener('scroll', update);
```

```tsx
// SharedAppLayout.tsx / RemoteAppShell.tsx
<div
  className={isMobile ? "fixed inset-x-0 top-0" : "h-screen"}
  style={isMobile ? { height: 'var(--app-vh, 100dvh)' } : undefined}
>
```

---

## 13. Touch Target Audit (Ongoing)

| Component | Current Size | Target | Status |
|-----------|-------------|--------|--------|
| Composer Send | 44×44 (w-11 h-11) | ≥44px | ✓ Compliant |
| Navbar hamburger | ~40×40 (inferred) | ≥44px | ⚠ Verify |
| Navbar icons (create/user/settings) | ~32×32 (inferred) | ≥44px | ⚠ P1 (audit §N3) |
| Mobile tab icons | ~28×32 (small targets) | ≥44px | ⚠ P1 (audit §N4) |
| Inline approval Approve/Deny | 32×32 (h-8 w-8) | ≥44px | ✗ P1 (audit §A2) |
| Plan-approval Stop/Approve/Request | ~36-40×36-40 (`size="sm"`) | ≥44px | ⚠ Verify after G4 |
| Kanban card (entire card) | Full width, ~80px tall | ≥44px | ✓ Compliant |
| Kanban filter search toggle | Icon button | ≥44px | ⚠ Verify |

Legend:
- ✓ Compliant: verified ≥44px
- ⚠ Verify: likely close, needs measurement
- ✗ P1: confirmed under 44px, must fix

---

## 14. Safe Area Handling

All mobile layouts include `pb-[env(safe-area-inset-bottom)]` to avoid the iPhone home indicator / notch:

```
┌─────────────────────────────────────┐
│                                     │
│          [Content area]             │
│                                     │
├─────────────────────────────────────┤
│  Composer / Actions                 │ ← Above safe area
└─────────────────────────────────────┘
  ════════════════════════════════════   ← env(safe-area-inset-bottom)
  ────────────────────────────────────   ← iPhone home indicator

Applied at shell level:
- SharedAppLayout.tsx:305
- RemoteAppShell.tsx:253
- MobileDrawer.tsx:73
```

---

## 15. What's Not Shown (Out of M0 Scope)

These surfaces exist but are **desktop-only** for M0:

1. **Kanban board mobile layout**: The board still renders desktop horizontal columns on ≤767px. The kanban route is accessible, but the P1 finding (audit §K1) defers mobile-optimized board layout (vertical single-column or card-list view) to post-M0.

2. **Workspace Files/Changes/Logs/Preview/Git tabs**: Mounted but hidden (G7). The data still loads; a future mobile-only WorkspacesLayout would unmount them entirely.

3. **Multi-file diff view**: Design §6.4 specifies unified-by-default (already implemented), but reviewing large multi-file diffs on 390px is not optimized. Single-file inline diffs in chat are supported.

4. **Logs panel advanced controls**: On mobile, the Logs tab (if unhidden) loses the search input and process picker (audit §L1, P1). Streaming log body with wrapping works; filtering doesn't.

5. **Git panel interactive actions**: The Git tab isn't shown on mobile. Git dialogs (CreatePR, Rebase, etc.) are accessible via other routes but suffer from the dialog primitive P1 gap (no max-height/scroll).

6. **Preview browser interactive controls**: The preview browser has a mobile-collapsed toolbar, but it's a "view-only" experience. The full zoom/scale/reload controls are desktop-focused.

---

## 16. Next Steps (G1/G2 → M1)

To close remaining M0 → M1 gaps:

1. **G1/G2: Bottom-fixed approval banner** (closes audit P0 §A1, P1 §A2)
   - Surface a sticky approval bar when `hasPendingApproval=true`
   - ≥44px Approve/Deny targets with visible labels (no hover-only tooltips)
   - Render below navbar, above composer (or replace composer footer when active)

2. **Dialog primitive max-height fix** (closes audit P1 §D1)
   - Add `max-h-[calc(100dvh-2rem)] overflow-y-auto` to `Dialog.tsx:46`
   - Add 1rem top/bottom margin (or switch to bottom sheet for mobile)
   - Test on: CreatePRDialog, RebaseDialog, GitActionsDialog, LinkPrToIssueDialog

3. **Navbar/tab touch targets** (closes audit P1 §N3, §N4)
   - Bump navbar icons (create/user/settings) to ≥44px
   - Increase mobile tab icon hit area (currently ~28px tall)
   - Verify hamburger menu is ≥44px

4. **Verify keyboard handling across all approval paths**
   - Plan-approval (composer footer) should inherit G4 fix ✓
   - New approval banner (G1/G2) must also be above keyboard
   - Test on iOS Safari 390px width

5. **Optional: Unmount hidden mobile panels**
   - WorkspacesLayout mobile branch could skip mounting Files/Changes/Logs/Preview/Git
   - Saves memory, but adds complexity (conditional data hooks)
   - Not blocking M0 acceptance criteria

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `packages/web-core/src/shared/hooks/useIsMobile.ts` | Mobile detection (767px viewport) |
| `packages/web-core/src/shared/hooks/useVisualViewportHeightVar.ts` | G4 keyboard fix (--app-vh CSS var) |
| `packages/web-core/src/shared/components/ui-new/containers/SharedAppLayout.tsx` | Local app shell (mobile flex column, desktop grid) |
| `packages/remote-web/src/app/layout/RemoteAppShell.tsx` | Remote app shell (mobile flex column) |
| `packages/web-core/src/pages/workspaces/WorkspacesLayout.tsx` | 3-col → mobile tabs (chat/files/changes/logs/preview/git) |
| `packages/web-core/src/shared/components/ui-new/containers/NavbarContainer.tsx` | G7 mobile tab filtering (chat only) |
| `packages/remote-web/src/app/layout/RemoteNavbarContainer.tsx` | G7 remote mobile tabs (chat only) |
| `packages/ui/src/components/MobileDrawer.tsx` | Slide-in navigation drawer |
| `packages/ui/src/components/SessionChatBox.tsx` | Composer + approval modes (plan/question approval footer) |
| `packages/ui/src/components/Dialog.tsx` | Dialog primitive (needs max-height fix) |
| `packages/web-core/src/shared/dialogs/settings/SettingsDialog.tsx` | Reference: mobile-friendly full-screen modal |

---

## Document Maintenance

- Update §2 (keyboard interaction) when G1/G2 add approval banner
- Update §9/§10 (dialog behavior) after Dialog.tsx primitive fix
- Update §13 (touch targets) after navbar/tab icon sizing changes
- Archive or delete outdated sections as features ship
