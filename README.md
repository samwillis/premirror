# Premirror Monorepo

Premirror is a library for building Word-class page layout editors on the web.
This repository is a Bun workspace monorepo containing reusable packages plus a
demo app.

## Workspace layout

- `packages/core` - shared public types and configuration contracts.
- `packages/composer` - pagination and composition engine.
- `packages/prosemirror-adapter` - ProseMirror bridge and mapping contracts.
- `packages/react` - React integration components and hooks.
- `apps/demo` - reference application demonstrating the library.
- `docs/design-proposal.md` - architecture and roadmap proposal.

## Development

```sh
bun install
bun dev
```

## Build and checks

```sh
bun run build
bun run typecheck
bun run lint
```
# Premirror

Premirror is a library project to enable Word-class page layout editing on the
web, built on top of ProseMirror and React.

## Current focus

The first implementation milestone is accurate, deterministic paper-style
pagination. After that, the roadmap expands into multi-column layout, floating
boxes, and other advanced document composition capabilities.

## Design proposal

See `docs/design-proposal.md` for the architecture proposal, milestones, and
scope decisions.

## Development

```sh
bun install
bun dev
```
