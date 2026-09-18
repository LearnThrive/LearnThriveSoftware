# Whiteboard Architecture

How the collaborative whiteboard actually works: the server-side state model, the sync protocol, and the client-side reconciliation. See [CLASSROOM_FEATURES.md](CLASSROOM_FEATURES.md) for a feature-level summary and [README.md](README.md) for the rest of the app.

## Why Excalidraw

`@excalidraw/excalidraw` is used as-is, not forked or reimplemented. It owns the canvas, the drawing tools, undo/redo, and (via `updateScene({ collaborators })`) native rendering of other participants' cursors and laser trails. This app's job is purely the **transport and reconciliation** layer around it: getting the right elements in and out of Excalidraw's own scene at the right times.

## Server-side state model (`server/signalling.ts`)

Each room holds:

```ts
interface RoomBoardPage { id: string; name: string; background: BoardBackground; elements: Map<string, BoardElement> }
interface RoomBoard { pages: RoomBoardPage[]; activePageId: string; studentsCanDraw: boolean }
```

`BoardElement` (`shared/protocol.ts`) is deliberately loose:

```ts
interface BoardElement { id: string; version: number; versionNonce: number; isDeleted?: boolean; [key: string]: unknown }
```

**The server is schema-blind to everything except `id`/`version`/`versionNonce`/`isDeleted`.** It never validates or interprets stroke color, points, text content, or any other Excalidraw-specific field — that schema belongs entirely to the client. This keeps the server decoupled from Excalidraw's internal element shape (which does change between versions) and means the server's only real job is **reconciliation and access control**, not drawing-domain validation.

A brand-new room starts with one page, `"Board 1"`, blank background, `studentsCanDraw: true`.

## Reconciliation: the version/versionNonce rule

Both the server (accepting an incoming `board:update` batch) and the client (merging a remote batch into its at-rest cache) use the identical rule:

```ts
function shouldAccept(existing, incoming) {
  if (incoming.version > existing.version) return true;
  if (incoming.version === existing.version && incoming.versionNonce > existing.versionNonce) return true;
  return false;
}
```

This is the same merge strategy Excalidraw's own collaboration reference implementation (`excalidraw-room`) uses, and the client additionally uses Excalidraw's own exported `reconcileElements()` when merging into the **live** scene (see below) — the server's simpler hand-rolled version only ever touches its own at-rest `Map`, never a live Excalidraw instance.

A stale update (equal-or-lower version, or equal version with an equal-or-lower versionNonce) is **silently dropped**, never broadcast, never overwrites the server's copy. This is what makes concurrent editing safe: two participants drawing at the same time on the same page will always converge, because both sides apply the identical deterministic rule to the identical version numbers Excalidraw itself assigns.

## Sync protocol (`shared/protocol.ts`)

Incremental only — the plan explicitly ruled out broadcasting the entire board on every pointer movement:

- `board:update { pageId, elements }` (client→server, then server→everyone-except-sender): a *batch* of changed elements, not the whole scene. The server reconciles each element against its own copy and rebroadcasts only the ones actually accepted.
- `board:cursor` / `board:laser` (client→server→everyone-except-sender): ephemeral position broadcasts, throttled client-side (~70-120ms) and rate-limited server-side as a backstop. Never written into board history — a laser trail that isn't actively being re-sent just fades via Excalidraw's own trail renderer.
- `board:snapshot`-equivalent: rather than a separate event, the **full board state (every page's elements)** rides along inside the existing `room:joined` payload — used identically for a brand-new admission, a duplicate join, and a `socket.recovered` reconnect resync. This means a client that's been offline for a bit, or one that switches to a page it's never viewed before, always has a complete local mirror to work from without a dedicated fetch.
- Page management (`board:page-create/rename/delete/reorder/switch/background`) broadcasts a full page-metadata list (`board:pages-update`) — cheap, since a room has at most `MAX_BOARD_PAGES` (20) pages and this never includes element data.

**Why every page's elements are always synced, not just the active one:** the alternative (only syncing the page currently "in view") would mean a page-switch needs a server round-trip, and a student who stops following the tutor and browses a different page would stop receiving live updates for it. Given a 4-person classroom board's realistic total data size, mirroring everything everywhere is simpler and correct by construction, at negligible cost.

## Why "duplicate a page" isn't its own wire event

`board:page-duplicate` doesn't exist. Duplicating is composed client-side from three existing primitives: `board:page-create` (server auto-names it and makes it active), then — once the resulting `board:pages-update` reveals the new page's id — `board:page-rename` (to `"<source> copy"`) and `board:update` (seeding it with the source page's elements, each given a fresh id so the two pages never share element identity). The client already holds the source page's full element set locally (see "every page's elements are always synced" above), so no new server-side duplication logic was needed at all. See `MeetingController.duplicateBoardPage` in `src/meeting.ts`.

## Client-side architecture (`src/meeting.ts` + `src/components/Whiteboard.tsx`)

**`MeetingController`** (the single source of truth for all room state in this app, whiteboard included) holds:

```ts
board: { pages, activePageId, elementsByPage: Record<pageId, BoardElement[]>, studentsCanDraw }
```

`elementsByPage` is an **at-rest cache**, updated in exactly two ways:

1. On any remote-originated event (`board:update`, `board:cleared`, the initial `room:joined`/resync) — reconciled via the same version/versionNonce rule described above.
2. On a **local page switch**, right before navigating away — the Whiteboard component reads whatever's currently in Excalidraw's live scene (`getSceneElementsIncludingDeleted()`) and commits it into the cache for the page being left, via `commitLocalPageElements`. This closes a real gap: without it, switching away from a page and back before your own just-drawn strokes had round-tripped through the server would show a stale version.

It is **never** updated directly from your own `onChange` while actively drawing — Excalidraw's own live scene is the source of truth for whatever page you're currently looking at, and the cache only needs to reflect it at page-switch boundaries or when a page you're *not* looking at changes remotely.

**`Whiteboard.tsx`** ties this together with one effect, keyed on `[viewedPageId, elementsByPage[viewedPageId]]`:

```ts
useEffect(() => {
  if (prevViewedPageId !== viewedPageId) commitLocalPageElements(prevViewedPageId, api.getSceneElementsIncludingDeleted());
  const reconciled = reconcileElements(api.getSceneElementsIncludingDeleted(), incomingElements, api.getAppState());
  api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
}, [viewedPageId, elementsByPage[viewedPageId]]);
```

This single effect fires on both triggers the design needs to handle identically — an explicit page switch (local or tutor-driven) and a remote update arriving for the page currently being viewed — because in both cases the correct response is "reconcile whatever's live against whatever's now in the cache." `captureUpdate: CaptureUpdateAction.NEVER` is what stops a remote peer's edit from ever landing on your own local undo/redo stack (a student pressing Ctrl+Z can never accidentally remove another participant's unrelated change).

Local edits flow the other way: `onChange` diffs the incoming element list against a `Map` of `{version, versionNonce}` last sent per element id, and only the elements that actually changed are queued into a trailing-edge throttle (`src/board.ts`'s `trailingThrottle`, ~120ms) before being sent as a `board:update` batch. Because the server never echoes a `board:update` back to its own sender, this local diffing state is never touched by the reconciliation effect above — there is no feedback loop to reason about.

## Backgrounds: CSS, not elements

The plan was explicit: don't create thousands of Excalidraw line elements for a grid or ruled-paper background. Backgrounds are rendered as a CSS `background-image` (repeating linear/radial gradients) on the container **behind** the Excalidraw canvas, with the canvas's own `viewBackgroundColor` set to `transparent` so the pattern shows through. A background costs zero board-element budget, never appears in export/undo history, and switches instantly (`src/board.ts`'s `boardBackgroundStyle`).

## Permission enforcement

`studentsCanDraw` is enforced **server-side** (a disallowed student's `board:update` is rejected outright with `room:error`), with `viewModeEnabled` set client-side as a UX convenience so a disallowed student doesn't even see editable tool affordances. The server check is the real authority; the client-side view-mode is not relied upon alone, matching the plan's explicit instruction not to gate mutation behind a hidden toolbar alone.

## What's not built

- **Tutoring shortcuts** (number line, axes, fraction bar) are minimal — they insert a pre-built Excalidraw element skeleton via `convertToExcalidrawElements`, not a symbolic math editor (explicitly out of scope per the plan).
- **Page rename has no keyboard-only trigger** (double-click only) — see [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md).
- **No visual regression testing** of the canvas itself — Excalidraw's canvas rendering isn't pixel-asserted (the plan explicitly warns against brittle pixel-perfect tests for dynamic content); correctness is proven functionally instead (a Playwright test that draws a real shape via the actual toolbar and mouse events, and confirms it lands in another browser).
