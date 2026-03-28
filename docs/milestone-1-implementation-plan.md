# Premirror Milestone 1 Implementation Plan

## Milestone Goal

Ship a usable library baseline that composes paginated pages from ProseMirror
content with deterministic output and a reference demo.

## Milestone Outcomes

1. Monorepo packages wired end-to-end (`core` + `composer` +
   `prosemirror-adapter` + `react`) and consumed by `apps/demo`.
2. First production-quality pagination pipeline for block + paragraph flow.
3. Policy controls for manual page break, keep-with-next, and widow/orphan v1.
4. Stable page rendering in demo with deterministic break diagnostics.
5. Test and profiling harness sufficient to protect milestone behavior.

## Milestone 1 Architectural Decisions (Locked)

1. Rendering model:
   - Single ProseMirror `contenteditable` root (no multi-root pages in M1).
   - Composer-driven visual pagination rendered from `LayoutOutput`.
   - Paragraph/page splits represented as layout fragments, not PM node splits.
2. Measurement ownership:
   - Run measurement occurs upstream of `composeLayout`.
   - `composeLayout` consumes pre-measured run handles and remains deterministic.
3. Mark support in M1:
   - At minimum: `strong`, `em`, and `code`.
4. Schema extension usage:
   - M1 may introduce explicit pagination semantics (for example manual
     page-break representation) through `schemaExtensions`.

## Ownership Contract (Implementation Rule)

All M1 workstreams must preserve this boundary:

1. ProseMirror layer:
   - Owns canonical document/transaction/selection state.
2. Composer layer:
   - Owns deterministic line/page/fragment computation.
3. Renderer layer:
   - Positions fragment nodes directly from composer output.
   - Renders page boundaries/chrome outside PM content as independent UI.
4. Mapping layer:
   - Bridges PM positions and rendered fragment geometry.

Non-negotiable rule:

- No multi-root PM doc ownership in M1.
- No implicit browser flow authority for page breaks.
- Fragment movement is renderer-driven from composed geometry.

## Workstreams

The plan is split into eight workstreams that can run partially in parallel.

### Workstream A - API and Contracts (`@premirror/core`)

Scope:

1. Define public types used across packages:
   - `PageSpec`, `PageMargins`, `TypographyConfig`, `LayoutPolicyConfig`
   - `DocumentSnapshot`, `LayoutInput`, `LayoutOutput`, `MappingIndex`
   - `BreakReason`, `InvalidationPlan`, `ComposeMetrics`
   - pre-measured run handle contracts used by the composer
2. Define stable options and return contracts:
   - `createPremirror(options)`
   - `composeLayout(snapshot, previous, input)`
3. Freeze naming and field semantics for Milestone 1 (no implicit behavior).
4. Lock rendering architecture contracts in types from Sequence 1.

Deliverables:

- Typed contracts and package exports documented in-source.
- API notes in `packages/core/src` for v0.1 expectations.

Exit criteria:

- Other packages compile against `core` contracts without local type forks.
- Type-level tests verify required/optional fields and invariants.

### Workstream B - ProseMirror Extraction and Mapping (`@premirror/prosemirror-adapter`)

Scope:

1. Build snapshot extraction from PM state into `DocumentSnapshot`.
2. Represent block sequence and styled text runs for composition input.
3. Resolve mark-aware typography and pre-measure runs before compose.
4. Build first mapping layer:
   - PM position -> block/run offset
   - composed line offset -> PM position
5. Add transaction metadata support for invalidation hints.

Milestone 1 supported node set:

- `doc`, `paragraph`, `heading`, `blockquote`, `hard_break`, `text`
- list nodes may be flattened to paragraph-like blocks for v1 behavior

Milestone 1 supported marks:

- `strong`, `em`, `code`

Out of scope in Milestone 1:

- tables, floating objects, footnotes/endnotes, multi-column section nodes

Deliverables:

- Adapter utilities and plugin scaffolding.
- Deterministic extraction fixtures from PM JSON docs.

Exit criteria:

- Round-trip mapping tests pass on representative fixtures.
- Adapter emits stable snapshots for semantically equivalent transactions.

### Workstream C - Composer Core (`@premirror/composer`)

Scope:

1. Implement pagination primitives:
   - page box geometry
   - content frame bounds
   - cursor through blocks/lines
2. Integrate Pretext for paragraph composition:
   - run grouping by effective typography style
   - line fitting with deterministic inputs
   - styled-run packer modeled after `pretext/pages/demos/rich-note.ts`
3. Implement block flow across page boundaries.
4. Produce `LayoutOutput` with:
   - pages, frames, block fragments, line boxes
   - break reasons and compose metrics

Deliverables:

- Deterministic `composeLayout()` implementation.
- Structured break reason model for debugging and tests.

Exit criteria:

- Same `DocumentSnapshot + LayoutInput` always yields identical `LayoutOutput`.
- Snapshot tests pass across fixture corpus.

### Workstream D - Policies v1 (`@premirror/composer`)

Scope:

1. Manual page break policy:
   - explicit break blocks or marks mapped from adapter metadata.
2. Keep-with-next policy:
   - prevent isolated heading/lead block at page bottom.
3. Widow/orphan v1:
   - minimum lines at top/bottom of page for multi-line paragraphs.

Deliverables:

- Policy evaluator integrated into composition decision loop.
- Break diagnostics exposing which rule forced each decision.

Exit criteria:

- Policy fixtures pass for expected page distribution.
- Diagnostics explain every non-trivial page transition.

### Workstream E - React Integration (`@premirror/react`)

Scope:

1. Build page viewport components for composed output.
2. Render page chrome and block/line overlays for debug mode.
3. Provide hooks to connect adapter + composer lifecycle to React updates.
4. Keep integration boundary `react-prosemirror`-friendly and fork-safe.

Planned `react-prosemirror` usage in M1:

- `ProseMirror` / `ProseMirrorDoc`
- `reactKeys()`
- `useEditorEffect`
- `useEditorEventCallback` / `useEditorEventListener`
- `nodeViewComponents`
- `widget()` decorations

Fork triggers (defer unless required):

1. Need multiple contenteditable roots (for example one editable root per page).
2. Need to override root document DOM structure below public APIs.
3. Need low-level selection/caret painting behavior not exposed by hooks/props.

Deliverables:

- Components/hooks to render paged output from `LayoutOutput`.
- Minimal API consumed by demo without app-specific coupling.

Exit criteria:

- Demo can render and update paginated pages after document edits.
- React package exports remain framework-thin and reusable.

### Workstream F - Demo Application (`apps/demo`)

Scope:

1. Build reference editor integration with paged viewport.
2. Use Base UI primitives plus custom CSS for the demo shell.
3. Add controls:
   - page preset switch (A4/Letter)
   - margins and line-height tuning
   - debug toggle (break reasons, compose timings, invalidations)
4. Mock a Word-like editing UI with minimal controls:
   - top toolbar row
   - document title row
   - page canvas viewport with visible paper boundaries
   - minimal formatting controls for M1 (`bold`, `italic`, `code`, page break)
5. Add canonical fixture documents:
   - short simple doc
   - long narrative doc
   - mixed-script doc (LTR/RTL/CJK sample)

Deliverables:

- Live demo proving Milestone 1 behavior.
- Visual debug panel for development and stakeholder review.
- Base UI + CSS shell that can be incrementally expanded in later milestones.

Exit criteria:

- Editing and pagination remain stable in all fixture docs.
- Debug panel confirms deterministic recomposition in repeated runs.
- Demo presents a credible Word-like baseline UI with minimal controls.

### Workstream G - Testing and Quality Gates

Scope:

1. Unit tests:
   - contracts and helper logic (`core`)
   - extraction/mapping (`prosemirror-adapter`)
   - composition and policies (`composer`)
2. Snapshot tests:
   - `LayoutOutput` and break-reason consistency on fixtures
3. Integration tests:
   - end-to-end edit -> recompose -> render path in demo harness
   - structural assertions on rendered page tree for rendering correctness

Milestone 1 quality gates:

1. Determinism: same input -> byte-equivalent layout snapshot.
2. Mapping: position round-trip invariants hold across edited docs.
3. Stability: no fatal selection/cursor regressions in tested flows.

Deliverables:

- Fixture corpus and snapshot baseline committed in-repo.
- CI command set that runs quickly on each PR.

Exit criteria:

- All gates pass in CI.
- Regression introduced by composition changes is caught by snapshots.

### Workstream H - Performance Instrumentation

Scope:

1. Add compose timing metrics:
   - extraction time
   - composition time
   - policy evaluation overhead
2. Emit invalidation stats:
   - affected blocks/pages
   - recomposition depth
3. Add demo panel for real-time profiling readouts.

Milestone 1 baseline targets (initial, adjustable after first profiling):

- Local paragraph edit in medium doc: recompose visible pages in < 16ms median.
- Full recomposition in medium doc: < 120ms median.
- Determinism check mode: no layout drift across repeated passes.

Medium doc definition:

- ~50 pages, ~500 paragraphs, mixed heading/body text, with `strong`/`em`/`code`
  marks and representative hard breaks.

Deliverables:

- Shared profiling utilities and debug telemetry in layout output.

Exit criteria:

- Performance counters visible and trusted by tests/manual runs.
- Documented baseline numbers captured in repository notes.

## Suggested Execution Sequence

1. Sequence 1: lock rendering architecture decision + contracts + adapter
   skeleton + fixture harness.
2. Sequence 2: composer core without policies, deterministic snapshots.
3. Sequence 3: policies v1 and mapping round-trip hardening.
4. Sequence 4: React integration package + demo paged viewport.
5. Sequence 5: instrumentation, optimization pass, docs and API cleanup.

## Demo UI Baseline (Milestone 1)

Milestone 1 demo UI should prioritize clarity over feature breadth:

1. Component foundation:
   - Base UI components for toolbar menus, buttons, toggles, and popovers.
   - Custom CSS for page surface, app chrome, spacing, and typography.
2. Layout regions:
   - Header: document name and status badges (draft/debug).
   - Toolbar: essential formatting and layout controls only.
   - Editor area: paged paper surface with visible margins.
   - Optional side panel: compose timings and break diagnostics.
3. Interaction scope:
   - No full ribbon UI in M1.
   - No advanced inspector panes in M1.
   - Keep controls intentionally minimal and implementation-focused.

## Definition of Done

Milestone 1 is complete when all conditions below are true:

1. Library users can compose paginated output from ProseMirror documents using
   documented package APIs.
2. Pagination is deterministic and policy-aware (manual break, keep-with-next,
   widow/orphan v1).
3. Mapping invariants pass on committed fixtures.
4. Demo app proves live editing with stable page layout and debug visibility.
5. CI quality gates and baseline performance metrics are established.

## Immediate Next Actions

1. Finalize Milestone 1 contract types in `@premirror/core`.
2. Land snapshot extraction + mapping round-trip scaffolding.
3. Implement first deterministic compose pipeline with page/frame output.
4. Wire policies v1 and expose break-reason diagnostics.
5. Integrate into demo and lock fixture snapshots plus baseline metrics.
