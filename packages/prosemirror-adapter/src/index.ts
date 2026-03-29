/**
 * @premirror/prosemirror-adapter — ProseMirror integration for Milestone 1.
 */

import { layoutNextLine, prepareWithSegments } from "@chenglou/pretext";
import type {
  BlockSnapshot,
  MeasuredDocumentSnapshot,
  MeasuredRun,
  PremirrorOptions,
  ResolvedMarkSet,
  StyledRun,
  TypographyConfig,
  UnmeasuredDocumentSnapshot,
} from "@premirror/core";
import { keymap } from "prosemirror-keymap";
import type { Mark, Node as PMNode, Schema } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";

// --- Meta & invalidation -----------------------------------------------------

export const PREMIRROR_META_KEY = "premirror";

export type PremirrorTransactionMeta = {
  invalidateFromPos: number;
  invalidateToPos: number;
};

export type PremirrorCommands = {
  insertPageBreak: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
};

export type SchemaExtension = {
  nodes?: Record<string, unknown>;
  marks?: Record<string, unknown>;
};

export type PremirrorRuntime = {
  plugins: Plugin[];
  keymaps: Plugin[];
  commands: PremirrorCommands;
  schemaExtensions: SchemaExtension[];

  toSnapshot: (state: EditorState) => UnmeasuredDocumentSnapshot;
  measureSnapshot: (snapshot: UnmeasuredDocumentSnapshot) => MeasuredDocumentSnapshot;
  getInvalidationRange: (state: EditorState) => { from: number; to: number } | null;
};

export type PremirrorInvalidationState = { from: number; to: number } | null;

export const premirrorInvalidationKey = new PluginKey<PremirrorInvalidationState>("premirrorInvalidation");

function invalidationRangeFromTransaction(tr: Transaction): { from: number; to: number } | null {
  if (!tr.docChanged) return null;
  const size = tr.doc.content.size;
  return { from: 1, to: Math.max(1, size) };
}

function createInvalidationPlugin(): Plugin {
  return new Plugin<PremirrorInvalidationState>({
    key: premirrorInvalidationKey,
    state: {
      init(): PremirrorInvalidationState {
        return null;
      },
      apply(tr, prev): PremirrorInvalidationState {
        const meta = tr.getMeta(PREMIRROR_META_KEY) as PremirrorTransactionMeta | undefined;
        if (
          meta &&
          typeof meta.invalidateFromPos === "number" &&
          typeof meta.invalidateToPos === "number"
        ) {
          return { from: meta.invalidateFromPos, to: meta.invalidateToPos };
        }
        const derived = invalidationRangeFromTransaction(tr);
        if (derived) return derived;
        return prev;
      },
    },
  });
}

// --- Schema extension descriptors (draft, merge-safe) ------------------------

const paginationSchemaExtensions: SchemaExtension[] = [
  {
    nodes: {
      paragraph: {
        attrs: {
          manualPageBreakBefore: { default: false },
        },
      },
    },
  },
];

// --- Typography → font string ------------------------------------------------

function parseFontSizePx(typography: TypographyConfig): number {
  const m = typography.defaultFont.match(/(\d+(?:\.\d+)?)\s*px/i);
  if (m) return parseFloat(m[1]!);
  return Math.max(10, Math.round(typography.defaultLineHeightPx * 0.8));
}

function resolveFont(typography: TypographyConfig, marks: ResolvedMarkSet): string {
  const sizePx = parseFontSizePx(typography);
  const weight = marks.strong === true ? 700 : 400;
  const style = marks.em === true ? "italic" : "normal";
  const defaultFamily = typography.defaultFont.includes("px")
    ? typography.defaultFont.replace(/^\s*\d+(?:\.\d+)?px\s+/i, "")
    : typography.defaultFont;
  const family = marks.code === true ? "ui-monospace, SFMono-Regular, Menlo, monospace" : defaultFamily;
  return `${style} ${weight} ${sizePx}px ${family}`;
}

function toResolvedMarkSet(marks: readonly Mark[]): ResolvedMarkSet {
  const out: ResolvedMarkSet = {};
  for (const m of marks) {
    if (m.type.name === "strong") out.strong = true;
    else if (m.type.name === "em") out.em = true;
    else if (m.type.name === "code") out.code = true;
    else if (m.type.name === "link" && m.attrs.href) out.linkHref = String(m.attrs.href);
  }
  return out;
}

function marksEqual(a: ResolvedMarkSet, b: ResolvedMarkSet): boolean {
  return (
    a.strong === b.strong &&
    a.em === b.em &&
    a.code === b.code &&
    a.linkHref === b.linkHref
  );
}

// --- Snapshot extraction ------------------------------------------------------

type ListContext = {
  depth: number;
  ordered: boolean;
  inBlockquote?: boolean;
};

function collectRunsForBlock(
  block: PMNode,
  blockStart: number,
  typography: TypographyConfig,
): StyledRun[] {
  const runs: StyledRun[] = [];
  let buf = "";
  let marks: ResolvedMarkSet = {};
  let runFrom = blockStart + 1;

  const flush = (exclusiveEnd: number): void => {
    if (buf.length === 0) {
      return;
    }
    const id = `run-${runFrom}-${runs.length}`;
    const resolvedMarks = { ...marks };
    runs.push({
      id,
      text: buf,
      font: resolveFont(typography, resolvedMarks),
      marks: resolvedMarks,
      pmRange: { from: runFrom, to: exclusiveEnd },
    });
    buf = "";
    marks = {};
    runFrom = exclusiveEnd;
  };

  block.forEach((child, offset) => {
    const pos = blockStart + 1 + offset;
    if (child.isText) {
      const childMarks = toResolvedMarkSet(child.marks);
      if (buf.length > 0 && !marksEqual(marks, childMarks)) {
        flush(pos);
      }
      if (buf.length === 0) {
        marks = childMarks;
        runFrom = pos;
      }
      buf += child.text ?? "";
    } else if (child.type.name === "hard_break") {
      const endPos = pos + child.nodeSize;
      flush(pos);
      buf = "\n";
      marks = toResolvedMarkSet(child.marks);
      runFrom = pos;
      flush(endPos);
    }
  });

  const blockEndExclusive = blockStart + block.nodeSize - 1;
  flush(blockEndExclusive);

  if (runs.length === 0) {
    runs.push({
      id: `run-${blockStart}-empty`,
      text: "",
      font: resolveFont(typography, {}),
      marks: {},
      pmRange: { from: blockStart + 1, to: blockStart + 1 },
    });
  }

  return runs;
}

function attrsForBlock(
  node: PMNode,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...node.attrs };
  for (const [k, v] of Object.entries(extra)) {
    base[k] = v;
  }
  return base;
}

function pushParagraphLike(
  blocks: BlockSnapshot[],
  node: PMNode,
  pos: number,
  type: BlockSnapshot["type"],
  typography: TypographyConfig,
  extraAttrs: Record<string, unknown>,
): void {
  const id = `block-${pos}`;
  const runs = collectRunsForBlock(node, pos, typography);
  blocks.push({
    id,
    type,
    attrs: attrsForBlock(node, extraAttrs),
    runs,
    pmRange: { from: pos, to: pos + node.nodeSize },
  });
}

function walkListItem(
  item: PMNode,
  pos: number,
  blocks: BlockSnapshot[],
  typography: TypographyConfig,
  ctx: ListContext,
): void {
  item.forEach((child, offset) => {
    const childPos = pos + 1 + offset;
    if (child.type.name === "paragraph") {
      pushParagraphLike(blocks, child, childPos, "paragraph", typography, {
        listItem: true,
        listDepth: ctx.depth,
        orderedList: ctx.ordered,
      });
    } else if (child.type.name === "heading") {
      pushParagraphLike(blocks, child, childPos, "heading", typography, {
        listItem: true,
        listDepth: ctx.depth,
        orderedList: ctx.ordered,
      });
    } else if (child.type.name === "bullet_list" || child.type.name === "ordered_list") {
      walkList(child, childPos, blocks, typography, {
        depth: ctx.depth + 1,
        ordered: child.type.name === "ordered_list",
        ...(ctx.inBlockquote === true ? { inBlockquote: true } : {}),
      });
    } else if (child.type.name === "blockquote") {
      walkBlockquote(child, childPos, blocks, typography, { listFlattened: true });
    } else if (child.type.name === "list_item") {
      walkListItem(child, childPos, blocks, typography, ctx);
    }
  });
}

function walkList(
  list: PMNode,
  pos: number,
  blocks: BlockSnapshot[],
  typography: TypographyConfig,
  ctx: ListContext,
): void {
  list.forEach((child, offset) => {
    const childPos = pos + 1 + offset;
    if (child.type.name === "list_item") {
      walkListItem(child, childPos, blocks, typography, ctx);
    }
  });
}

function walkBlockquote(
  quote: PMNode,
  pos: number,
  blocks: BlockSnapshot[],
  typography: TypographyConfig,
  extra: { listFlattened?: boolean },
): void {
  quote.forEach((child, offset) => {
    const childPos = pos + 1 + offset;
    if (child.type.name === "paragraph") {
      pushParagraphLike(blocks, child, childPos, "blockquote", typography, {
        inBlockquote: true,
        ...(extra.listFlattened === true ? { listFlattened: true } : {}),
      });
    } else if (child.type.name === "heading") {
      pushParagraphLike(blocks, child, childPos, "heading", typography, {
        inBlockquote: true,
      });
    } else if (child.type.name === "blockquote") {
      walkBlockquote(child, childPos, blocks, typography, {});
    } else if (child.type.name === "bullet_list" || child.type.name === "ordered_list") {
      walkList(child, childPos, blocks, typography, {
        depth: 1,
        ordered: child.type.name === "ordered_list",
        inBlockquote: true,
      });
    }
  });
}

function walkTopLevel(
  node: PMNode,
  pos: number,
  blocks: BlockSnapshot[],
  typography: TypographyConfig,
): void {
  if (node.type.name === "paragraph") {
    pushParagraphLike(blocks, node, pos, "paragraph", typography, {});
  } else if (node.type.name === "heading") {
    pushParagraphLike(blocks, node, pos, "heading", typography, {});
  } else if (node.type.name === "blockquote") {
    walkBlockquote(node, pos, blocks, typography, {});
  } else if (node.type.name === "bullet_list" || node.type.name === "ordered_list") {
    walkList(node, pos, blocks, typography, {
      depth: 1,
      ordered: node.type.name === "ordered_list",
    });
  }
}

function extractBlocks(doc: PMNode, typography: TypographyConfig): BlockSnapshot[] {
  const blocks: BlockSnapshot[] = [];
  doc.forEach((child, offset) => {
    const pos = offset;
    walkTopLevel(child, pos, blocks, typography);
  });
  return blocks;
}

function toSnapshotImpl(state: EditorState, typography: TypographyConfig): UnmeasuredDocumentSnapshot {
  return { blocks: extractBlocks(state.doc, typography) };
}

// --- Measurement -------------------------------------------------------------

function measureSnapshotImpl(snapshot: UnmeasuredDocumentSnapshot): MeasuredDocumentSnapshot {
  const measuredRuns: Record<string, MeasuredRun> = {};
  const UNBOUNDED_WIDTH = 1_000_000_000;
  for (const block of snapshot.blocks) {
    for (const run of block.runs) {
      try {
        const prepared = prepareWithSegments(run.text, run.font);
        const firstLine = layoutNextLine(
          prepared,
          { segmentIndex: 0, graphemeIndex: 0 },
          UNBOUNDED_WIDTH,
        );
        measuredRuns[run.id] = {
          runId: run.id,
          prepared,
          widthPx: firstLine?.width ?? 0,
          textLength: run.text.length,
        };
      } catch {
        measuredRuns[run.id] = {
          runId: run.id,
          prepared: {
            kind: "premirror-measurement-fallback",
            text: run.text,
            font: run.font,
          },
          widthPx: run.text.length * 7,
          textLength: run.text.length,
        };
      }
    }
  }
  return { ...snapshot, measuredRuns };
}

// --- Commands ----------------------------------------------------------------

function paragraphManualBreakAttrs(schema: Schema): Record<string, unknown> | null {
  const p = schema.nodes.paragraph;
  if (!p) return null;
  const spec = p.spec.attrs;
  if (!spec || !("manualPageBreakBefore" in spec)) return null;
  return { manualPageBreakBefore: true };
}

function insertPageBreakImpl(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  const attrs = paragraphManualBreakAttrs(state.schema);
  const { $from } = state.selection;
  const depth = $from.depth > 0 ? $from.depth : 1;
  const insertPos = $from.before(depth);
  const node = attrs ? paragraph.create(attrs) : paragraph.create();
  const tr = state.tr.insert(insertPos, node);
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

// --- Public factory ----------------------------------------------------------

export function createPremirror(options: PremirrorOptions): PremirrorRuntime {
  const invalidationPlugin = createInvalidationPlugin();
  const commands: PremirrorCommands = {
    insertPageBreak: insertPageBreakImpl,
  };

  const keymapPlugin = keymap({
    "Mod-Enter": (state, dispatch) => insertPageBreakImpl(state, dispatch),
  });

  return {
    plugins: [invalidationPlugin],
    keymaps: [keymapPlugin],
    commands,
    schemaExtensions: paginationSchemaExtensions,
    toSnapshot: (state) => toSnapshotImpl(state, options.typography),
    measureSnapshot: measureSnapshotImpl,
    getInvalidationRange: (state) => premirrorInvalidationKey.getState(state) ?? null,
  };
}
