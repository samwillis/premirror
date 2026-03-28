# Premirror Design Proposal

## Status

Draft v0.2 - aligned to a Bun workspace monorepo.

## Vision

Premirror is a library for building Word-class page-layout editors on the web.
It is not a single opinionated editor product. The library should enable teams
to compose their own editing experiences while reusing a shared layout engine,
pagination model, and ProseMirror integration layer.

The first milestone is accurate paper-style pagination. Future milestones add
columns, floating boxes, advanced block layout, and publishing features.

## Product Goals

1. Deterministic pagination for paper-sized pages (A4, Letter, custom).
2. High-fidelity layout behavior for rich text and complex mixed content.
3. Stable and responsive editing while layout reflows in near real time.
4. Library-first architecture with strong extension points and testability.
5. Demo application that proves capabilities and serves as a reference
   integration.

## Non-goals (for early phases)

1. Full parity with every Microsoft Word feature in v1.
2. Hard dependency on a specific app shell, state manager, or design system.
3. Locking users into one schema, one toolbar, or one UI paradigm.

## Design Principles

1. ProseMirror remains the document and transaction source of truth.
2. Layout is a separate deterministic model derived from document snapshots.
3. Render and layout concerns are separated to preserve debuggability.
4. Incremental recomposition is required for performance at scale.
5. API stability is a product feature; internals may evolve.

## Monorepo Structure (Bun)

The repository is a Bun monorepo with app and package workspaces:

- `apps/demo`
  - Reference app for interactive validation and feature demos.
- `packages/core`
  - Public contracts, common types, and shared options.
- `packages/composer`
  - Pagination and layout composition engine.
- `packages/prosemirror-adapter`
  - ProseMirror plugin integration and document/mapping adapters.
- `packages/react`
  - React integration primitives for paged rendering and overlays.

This structure keeps the library independently consumable while allowing the
demo app to stay in-repo and track the same evolving APIs.

## External Dependencies and Role

- `prosemirror-*`: document model, transactions, commands, plugin state.
- `@handlewithcare/react-prosemirror`: React-based rendering/integration layer.
- `@chenglou/pretext`: line measurement and line-break primitives.

## Why `react-prosemirror` (initially without a fork)

The library already provides a safe React rendering bridge and ProseMirror
event lifecycle integration. It gives us enough extension points to build page
composition on top (plugins, decorations, node/mark view components, effect
hooks) without immediately maintaining a heavy fork.

Forking remains an explicit fallback if hard requirements force low-level
changes to root mounting, selection mapping internals, or input/composition
behavior.

## Library Architecture

Premirror is organized into four library packages:

1. `@premirror/core`
   - Public types, configuration model, shared utilities.
   - Versioned API surface and feature flags.

2. `@premirror/prosemirror-adapter`
   - ProseMirror plugin bundle and schema helpers.
   - Document extraction to layout-ready blocks/runs.
   - Position mapping contracts (PM position <-> layout position).

3. `@premirror/composer`
   - Pagination and composition engine.
   - Page/frame model, break decisions, widow/orphan handling.
   - Incremental invalidation and recomposition planner.
   - Uses Pretext for line metrics and per-line fitting.

4. `@premirror/react`
   - React-facing components/hooks for page viewport and overlays.
   - Integration helpers for `react-prosemirror`.
   - Debug UI hooks (layout timing, break reasons, invalidation traces).

Separate app workspace:

- `apps/demo`
  - Reference implementation showcasing core and advanced features.
  - Not required by library consumers.

## Core Data Models

1. `DocumentSnapshot`
   - Immutable extraction of relevant PM content and style runs.

2. `LayoutInput`
   - Page settings, section settings, block constraints, float constraints,
     typography settings, and available frame geometry.

3. `LayoutOutput`
   - Pages -> frames -> block fragments -> line boxes.
   - Placement metadata and break reasons.

4. `MappingIndex`
   - Bidirectional mapping:
     - PM position -> layout location (page/frame/line/offset)
     - layout location -> PM position

5. `InvalidationPlan`
   - Which blocks/sections/pages need recomposition after a transaction.

## Pagination and Composition Engine (Starting Scope)

Phase 1 scope is accurate page layout with pagination:

1. Paper geometry and margins.
2. Block flow across page boundaries.
3. Paragraph line composition with Pretext.
4. Explicit/manual page breaks.
5. Keep-with-next and basic widow/orphan policy.
6. Deterministic page-break decisions with inspectable reasons.

Out of scope for phase 1:

- Multi-column sections, floating boxes, tables, footnotes/endnotes.

## Future Layout Capabilities

Planned evolution after pagination baseline:

1. Multi-column sections per page/frame.
2. Floating boxes (text/image) with exclusion geometry.
3. Anchored objects and wrap modes.
4. Headers/footers and section-level page settings.
5. Tables with stable editing semantics.
6. Footnotes/endnotes and constrained area allocation.

## Public API Direction (Draft)

```ts
type PremirrorOptions = {
  page: PagePreset | CustomPageSpec;
  typography: TypographyConfig;
  layoutPolicies?: LayoutPolicyConfig;
  features?: FeatureFlags;
};

type PremirrorPluginBundle = {
  plugins: Plugin[];
  commands: PremirrorCommands;
  keymaps: Plugin[];
  schemaExtensions: SchemaExtension[];
};

function createPremirror(options: PremirrorOptions): PremirrorPluginBundle;

function composeLayout(
  snapshot: DocumentSnapshot,
  previous: LayoutOutput | null,
  input: LayoutInput,
): LayoutOutput;
```

The exact API will be finalized after phase-1 implementation spike and tests.

## Performance Strategy

1. Incremental recomposition by invalidation regions, not full-doc recompute.
2. Cache prepared text runs and style metrics keyed by typography signature.
3. Separate urgent editing updates from non-urgent full reflow passes.
4. Maintain profiling counters per transaction (compose time, invalidated nodes).
5. Ship stress fixtures early (long docs, mixed scripts, many pages).

## Correctness Strategy

1. Determinism tests: same input produces same page breaks and mappings.
2. Mapping round-trip tests: PM position <-> layout location invariants.
3. Snapshot tests for page break reasons and block placements.
4. Browser regression checks for composition-sensitive interactions.
5. Manual quality gates in demo app for cursor/selection/IME behavior.

## Demo App Requirements

The demo app exists to validate and communicate library capability. It should:

1. Show realistic paged editing on A4/Letter docs.
2. Expose a debug panel for layout timings and break decisions.
3. Include stress examples (long technical doc, mixed RTL/CJK content).
4. Showcase advanced examples as features land (columns, floats, tables).
5. Remain thin enough that consumers can copy integration patterns.

## Delivery Plan

### Milestone 1 - Accurate Pagination Foundation

- Bun monorepo and workspace packages scaffolded.
- Page model and composition pipeline implemented.
- Paragraph + block flow pagination with deterministic output.
- Basic policy controls: manual break, keep-with-next, widows/orphans v1.
- Demo page showing live editing with stable page breaks.

### Milestone 2 - Editing Robustness and Performance

- Strong mapping layer for selection/caret behavior.
- Incremental invalidation and recomposition.
- Performance instrumentation and baseline targets.
- Expanded fixture coverage.

### Milestone 3 - Advanced Layout Primitives

- Multi-column flow.
- Floating boxes with exclusion paths.
- Anchored object positioning.

### Milestone 4 - Publishing-grade Features

- Tables v1, headers/footers, section controls.
- Footnotes/endnotes.
- Print/export parity and regression harness.

## Open Questions

1. Should multi-column be section-level only, or page-region level?
2. Which minimum table capability is required before calling v1 "usable"?
3. How strict should widow/orphan defaults be vs app-configurable policies?
4. Do we provide a first-party PDF/export package, or defer to integrators?

## Risks and Mitigations

1. High complexity in selection/caret mapping across reflow.
   - Mitigation: define mapping invariants early and test continuously.
2. Performance regressions on long documents.
   - Mitigation: incremental invalidation and profiling built from day one.
3. Upstream churn in `react-prosemirror`.
   - Mitigation: adapter boundary and optional fork path kept explicit.
4. Scope creep from "Word parity" ambition.
   - Mitigation: milestone gates and strict per-feature acceptance criteria.

## Immediate Next Steps

1. Draft `LayoutOutput` and `MappingIndex` type schemas in `@premirror/core`.
2. Implement a minimal composition spike in `@premirror/composer`.
3. Add ProseMirror extraction/mapping stubs in `@premirror/prosemirror-adapter`.
4. Add deterministic fixture tests for line/page break behavior.
5. Expand `apps/demo` to a paginated viewport with debug panel.
