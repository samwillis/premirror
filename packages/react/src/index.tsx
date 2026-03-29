import { composeLayout } from "@premirror/composer";
import type {
  ComposeDiagnostics,
  ComposeMetrics,
  LayoutInput,
  LayoutOutput,
  ProjectedSelection,
  Rect,
} from "@premirror/core";
import type { PremirrorRuntime } from "@premirror/prosemirror-adapter";
import type { EditorState } from "prosemirror-state";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement, ReactNode } from "react";

const PAGE_STACK_GAP_PX = 24;

export type PageLayoutMode = "single" | "spread";

type PagePlacement = {
  left: number;
  top: number;
};

type PageLayoutGeometry = {
  width: number;
  height: number;
  pagePlacements: PagePlacement[];
};

export type UsePremirrorEngineParams = {
  editorState: EditorState;
  runtime: PremirrorRuntime;
  layoutInput: LayoutInput;
  previousLayoutOverride?: LayoutOutput | null;
};

export type PremirrorEngineResult = {
  layout: LayoutOutput;
  diagnostics: ComposeDiagnostics;
};

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

/**
 * Runs snapshot → measure → compose on each `editorState` update, keeps the
 * previous layout for incremental compose, and returns merged timings.
 */
export function usePremirrorEngine(params: UsePremirrorEngineParams): PremirrorEngineResult {
  const { editorState, runtime, layoutInput, previousLayoutOverride } = params;
  const previousRef = useRef<LayoutOutput | null>(null);

  const layout = useMemo(() => {
    const tSnap0 = nowMs();
    const snapshot = runtime.toSnapshot(editorState);
    const tSnap1 = nowMs();
    const measured = runtime.measureSnapshot(snapshot);
    const tMeas1 = nowMs();

    const previousForCompose =
      previousLayoutOverride !== undefined ? previousLayoutOverride : previousRef.current;

    const composed = composeLayout(measured, previousForCompose, layoutInput);

    const metrics: ComposeMetrics = {
      ...composed.metrics,
      extractionMs: tSnap1 - tSnap0,
      measurementMs: tMeas1 - tSnap1,
    };

    return { ...composed, metrics };
  }, [editorState, runtime, layoutInput, previousLayoutOverride]);

  useLayoutEffect(() => {
    previousRef.current = layout;
  }, [layout]);

  const diagnostics: ComposeDiagnostics = {
    warnings: [],
    timings: layout.metrics,
  };

  return { layout, diagnostics };
}

export type PremirrorPageViewportProps = {
  layout: LayoutOutput;
  showDebug?: boolean;
  editorLayer: ReactNode;
  pageLayoutMode?: PageLayoutMode;
};

export function getPageLayoutGeometry(
  layout: LayoutOutput,
  pageLayoutMode: PageLayoutMode = "single",
): PageLayoutGeometry {
  if (layout.pages.length === 0) {
    return { width: 0, height: 0, pagePlacements: [] };
  }

  if (pageLayoutMode === "spread") {
    const rows = Math.ceil(layout.pages.length / 2);
    const rowTops: number[] = new Array(rows).fill(0);
    const rowHeights: number[] = new Array(rows).fill(0);
    const rowWidths: number[] = new Array(rows).fill(0);

    let runningTop = 0;
    for (let row = 0; row < rows; row++) {
      rowTops[row] = runningTop;
      const left = layout.pages[row * 2];
      const right = layout.pages[row * 2 + 1];
      const leftW = left?.spec.widthPx ?? 0;
      const rightW = right?.spec.widthPx ?? 0;
      const leftH = left?.spec.heightPx ?? 0;
      const rightH = right?.spec.heightPx ?? 0;
      const rowHeight = Math.max(leftH, rightH);
      rowHeights[row] = rowHeight;
      rowWidths[row] = leftW + (right ? PAGE_STACK_GAP_PX + rightW : 0);
      runningTop += rowHeight + (row < rows - 1 ? PAGE_STACK_GAP_PX : 0);
    }

    const pagePlacements: PagePlacement[] = layout.pages.map((_, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      if (col === 0) return { left: 0, top: rowTops[row] ?? 0 };
      const leftPageWidth = layout.pages[row * 2]?.spec.widthPx ?? 0;
      return { left: leftPageWidth + PAGE_STACK_GAP_PX, top: rowTops[row] ?? 0 };
    });

    return {
      width: Math.max(0, ...rowWidths),
      height: runningTop,
      pagePlacements,
    };
  }

  const pagePlacements: PagePlacement[] = [];
  let top = 0;
  let width = 0;
  for (let i = 0; i < layout.pages.length; i++) {
    const page = layout.pages[i]!;
    pagePlacements.push({ left: 0, top });
    top += page.spec.heightPx + (i < layout.pages.length - 1 ? PAGE_STACK_GAP_PX : 0);
    width = Math.max(width, page.spec.widthPx);
  }
  return { width, height: top, pagePlacements };
}

/**
 * Stacks page surfaces from `layout.pages` and mounts a single editor overlay
 * aligned to the stacked page origin. Content fragments are expected to be
 * positioned by ProseMirror decorations, not a duplicated text layer.
 */
export function PremirrorPageViewport(props: PremirrorPageViewportProps): ReactElement {
  const { layout, showDebug, editorLayer, pageLayoutMode = "single" } = props;
  const geometry = getPageLayoutGeometry(layout, pageLayoutMode);

  return (
    <div
      className="premirror-page-viewport"
      style={{ position: "relative", width: geometry.width, minHeight: geometry.height }}
    >
      {layout.pages.map((page, pageIdx) => {
        const placement = geometry.pagePlacements[pageIdx] ?? { left: 0, top: 0 };
        return (
        <div
          key={page.index}
          className="premirror-page-surface"
          style={{
            position: "absolute",
            left: placement.left,
            top: placement.top,
            width: page.spec.widthPx,
            height: page.spec.heightPx,
            background: "#fff",
            boxShadow: "0 2px 12px rgba(15, 23, 42, 0.12)",
            border: "1px solid #e5e7eb",
          }}
        >
          {page.frames.map((frame, fi) => (
            <div
              key={fi}
              style={{
                position: "absolute",
                left: frame.bounds.x,
                top: frame.bounds.y,
                width: frame.bounds.width,
                height: frame.bounds.height,
                boxSizing: "border-box",
              }}
            >
              {showDebug ? (
                <div
                  className="premirror-debug-overlay"
                  style={{
                    pointerEvents: "none",
                    position: "absolute",
                    inset: 0,
                    border: "1px dashed rgba(59, 130, 246, 0.45)",
                    background: "rgba(59, 130, 246, 0.04)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 6,
                      font: "11px/1.2 ui-monospace, monospace",
                      color: "#1d4ed8",
                      background: "rgba(255,255,255,0.85)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    frame {fi} · {frame.fragments.length} fragments
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {showDebug ? (
            <div
              style={{
                position: "absolute",
                right: 8,
                bottom: 6,
                font: "11px ui-monospace, monospace",
                color: "#6b7280",
              }}
            >
              page {page.index} · {page.spec.widthPx}×{page.spec.heightPx}px
            </div>
          ) : null}
        </div>
      );
      })}
      <div
        className="premirror-editor-overlay"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: geometry.width,
          height: geometry.height,
          pointerEvents: "none",
        }}
      >
        <div
          className="premirror-editor-surface"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "auto",
          }}
        >
          {editorLayer}
        </div>
      </div>
    </div>
  );
}

function collectRectsForPmRange(
  layout: LayoutOutput,
  from: number,
  to: number,
  pageLayoutMode: PageLayoutMode,
): Rect[] {
  const rects: Rect[] = [];
  const geometry = getPageLayoutGeometry(layout, pageLayoutMode);

  layout.pages.forEach((page, pageIdx) => {
    const pagePlacement = geometry.pagePlacements[pageIdx] ?? { left: 0, top: 0 };
    for (const frame of page.frames) {
      for (const frag of frame.fragments) {
        for (const line of frag.lines) {
          const lineFrom = line.pmRange.from;
          const lineTo = line.pmRange.to;

          if (from === to) {
            if (from < lineFrom || from > lineTo) continue;
            const runs = line.runs;
            const x0 =
              runs.length > 0
                ? pagePlacement.left + frame.bounds.x + Math.min(...runs.map((r) => r.x))
                : pagePlacement.left + frame.bounds.x;
            rects.push({
              x: x0,
              y: pagePlacement.top + frame.bounds.y + line.y,
              width: 2,
              height: line.height,
            });
            continue;
          }

          const lo = Math.max(from, lineFrom);
          const hi = Math.min(to, lineTo);
          if (lo >= hi) continue;

          const runs = line.runs;
          let x0 = pagePlacement.left + frame.bounds.x;
          let x1 = pagePlacement.left + frame.bounds.x + frame.bounds.width;
          if (runs.length > 0) {
            x0 = pagePlacement.left + frame.bounds.x + Math.min(...runs.map((r) => r.x));
            x1 = pagePlacement.left + frame.bounds.x + Math.max(...runs.map((r) => r.x + r.width));
          }
          rects.push({
            x: x0,
            y: pagePlacement.top + frame.bounds.y + line.y,
            width: Math.max(0, x1 - x0),
            height: line.height,
          });
        }
      }
    }
  });

  return rects;
}

/**
 * Projects the current selection into layout-space rectangles (stacked pages,
 * top origin). Collapsed selections yield a thin caret-sized rect on the
 * matching line when possible.
 */
export function useProjectedSelection(
  editorState: EditorState,
  layout: LayoutOutput | null,
  pageLayoutMode: PageLayoutMode = "single",
): ProjectedSelection {
  const { from, to } = editorState.selection;

  return useMemo(() => {
    if (!layout) {
      return { pmRange: { from, to }, rects: [] };
    }
    return {
      pmRange: { from, to },
      rects: collectRectsForPmRange(layout, from, to, pageLayoutMode),
    };
  }, [layout, from, to, pageLayoutMode]);
}
