# Premirror

Premirror is a library for building **Word-class page-layout editors** on the
web. It layers deterministic pagination and composition on top of
[ProseMirror](https://prosemirror.net/), giving you paper-style page breaks,
widow/orphan control, and fragment-level text positioning — all while keeping
ProseMirror as the single source of truth for document content and editing.

> **Live demo** — [samwillis.uk/premirror](https://samwillis.uk/premirror/)

## How It Works

ProseMirror owns the document model and all editing operations. Premirror's
**composer** takes a measured snapshot of the document and produces a
deterministic layout: pages, frames, line boxes, and placed runs. A React
rendering layer then projects those fragments into absolute positions inside
page-chrome viewports, producing a word-processor-style paged view with a single
`contenteditable` surface.

```
EditorState ──► snapshot ──► measure (pretext) ──► compose ──► LayoutOutput
                                                                   │
                                                    decorations ◄──┘
                                                        │
                                              PremirrorPageViewport
```

Text measurement is handled by
[@chenglou/pretext](https://github.com/chenglou/pretext), which provides
segment-aware width calculation and line fitting.

## Packages

This is a Bun workspace monorepo. All packages expose TypeScript sources
directly.

| Package | Path | Description |
|---------|------|-------------|
| `@premirror/core` | `packages/core` | Shared types, page specs, layout contracts, and configuration defaults |
| `@premirror/composer` | `packages/composer` | Pagination and composition engine — line breaking, page flow, widow/orphan policies |
| `@premirror/prosemirror-adapter` | `packages/prosemirror-adapter` | ProseMirror bridge: snapshot extraction, mark-aware measurement, invalidation plugin, commands |
| `@premirror/react` | `packages/react` | React hooks and components: `usePremirrorEngine`, `PremirrorPageViewport`, selection projection |
| `@premirror/demo-app` | `apps/demo` | Reference app demonstrating paged editing with toolbar, debug overlays, and timing readout |

## Development

Requires [Bun](https://bun.sh/) ≥ 1.3.

```sh
bun install
bun dev        # starts the Vite dev server for the demo app
```

### Build and checks

```sh
bun run build      # typecheck + build all packages and the demo app
bun run typecheck  # typecheck only
bun run lint       # tsc --noEmit across all workspaces
bun run test       # bun test across all workspaces
bun run benchmark  # run composer benchmark
```

## Tech Stack

- **Runtime / package manager** — Bun
- **Language** — TypeScript (strict)
- **Editor** — ProseMirror, with [@handlewithcare/react-prosemirror](https://github.com/handlewithcare/react-prosemirror) for React integration
- **Text measurement** — @chenglou/pretext
- **UI** — React 19, Base UI, Vite
- **Testing** — Bun test runner

## Documentation

- [`docs/design-proposal.md`](docs/design-proposal.md) — architecture, data models, and long-term roadmap
- [`docs/milestone-1-implementation-plan.md`](docs/milestone-1-implementation-plan.md) — M1 execution plan and definition of done
- [`docs/proposed-api-design.md`](docs/proposed-api-design.md) — package API contracts
- [`docs/testing-strategy.md`](docs/testing-strategy.md) — test suites, fixtures, CI, and performance protocol

## License

[MIT](LICENSE)
