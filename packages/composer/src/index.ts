import type {
  BandObstacle,
  BlockFragment,
  BlockSnapshot,
  BreakReason,
  ComposeMetrics,
  FrameLayout,
  Interval,
  LayoutInput,
  LayoutOutput,
  LayoutPoint,
  LineBox,
  MappingIndex,
  MeasuredDocumentSnapshot,
  PageLayout,
  PlacedRun,
  Rect,
  StyledRun,
} from "@premirror/core";
import { DEFAULT_LAYOUT_POLICIES } from "@premirror/core";

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

// -----------------------------------------------------------------------------
// Policy resolution
// -----------------------------------------------------------------------------

type ResolvedPolicies = {
  widowLinesMin: number;
  orphanLinesMin: number;
  keepWithNextEnabled: boolean;
  minSlotWidthPx: number;
  slotSelectionPolicy: "single_slot_flow" | "multi_slot_fill";
};

function resolvePolicies(input: LayoutInput): ResolvedPolicies {
  const p = input.policies;
  // M1: `multi_slot_fill` is contract-compatible but uses the same leftmost slot as `single_slot_flow`.
  return {
    widowLinesMin: p.widowLinesMin ?? DEFAULT_LAYOUT_POLICIES.widowLinesMin ?? 2,
    orphanLinesMin: p.orphanLinesMin ?? DEFAULT_LAYOUT_POLICIES.orphanLinesMin ?? 2,
    keepWithNextEnabled: p.keepWithNextEnabled ?? DEFAULT_LAYOUT_POLICIES.keepWithNextEnabled ?? true,
    minSlotWidthPx: p.minSlotWidthPx ?? DEFAULT_LAYOUT_POLICIES.minSlotWidthPx ?? 48,
    slotSelectionPolicy: p.slotSelectionPolicy ?? "single_slot_flow",
  };
}

// -----------------------------------------------------------------------------
// Run width (prepared.widthPx contract + deterministic fallback)
// -----------------------------------------------------------------------------

function readWidthFromPrepared(prepared: unknown): number | null {
  if (prepared && typeof prepared === "object" && prepared !== null && "widthPx" in prepared) {
    const w = (prepared as { widthPx: unknown }).widthPx;
    if (typeof w === "number" && Number.isFinite(w)) return w;
  }
  return null;
}

function runWidthPx(run: StyledRun, measured: MeasuredDocumentSnapshot["measuredRuns"]): number {
  const m = measured[run.id];
  const w = m ? readWidthFromPrepared(m.prepared) : null;
  if (w !== null) return Math.max(0, w);
  if (
    m &&
    typeof m.widthPx === "number" &&
    Number.isFinite(m.widthPx) &&
    typeof m.textLength === "number" &&
    m.textLength > 0
  ) {
    const ratio = run.text.length / m.textLength;
    return Math.max(0, m.widthPx * ratio);
  }
  /** Deterministic fallback when measurement is absent: 7px per code unit. */
  return run.text.length * 7;
}

function pmPosAtRunOffset(run: StyledRun, charFrom: number, charTo: number): { from: number; to: number } {
  const len = run.text.length;
  const span = run.pmRange.to - run.pmRange.from;
  if (len === 0) return { from: run.pmRange.from, to: run.pmRange.to };
  if (span === len) {
    return {
      from: run.pmRange.from + charFrom,
      to: run.pmRange.from + charTo,
    };
  }
  const from = run.pmRange.from + Math.floor((charFrom * span) / len);
  const toRaw = run.pmRange.from + Math.floor((charTo * span) / len);
  const to = charTo > charFrom ? Math.max(from + 1, toRaw) : toRaw;
  return { from, to };
}

// -----------------------------------------------------------------------------
// Geometry: frame + obstacles (M1 single-slot flow)
// -----------------------------------------------------------------------------

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let cur = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.start <= cur.end) cur = { start: cur.start, end: Math.max(cur.end, n.end) };
    else {
      out.push(cur);
      cur = n;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Picks the leftmost usable horizontal slot for `single_slot_flow`.
 * If carving yields no segment ≥ minSlotWidthPx, returns full frame width at x=0 (no-op-safe).
 */
function usableSlotForBand(
  frameWidth: number,
  lineTop: number,
  lineBottom: number,
  obstacles: BandObstacle[] | undefined,
  minSlotWidthPx: number,
): { x: number; width: number } {
  const blocked: Interval[] = [];
  for (const o of obstacles ?? []) {
    if (o.yEnd <= lineTop || o.yStart >= lineBottom) continue;
    blocked.push(...o.intervalsForBand(lineTop, lineBottom));
  }
  const merged = mergeIntervals(blocked);
  let cursor = 0;
  for (const b of merged) {
    const gapW = b.start - cursor;
    if (gapW >= minSlotWidthPx) return { x: cursor, width: gapW };
    cursor = Math.max(cursor, b.end);
  }
  const tail = frameWidth - cursor;
  if (tail >= minSlotWidthPx) return { x: cursor, width: tail };
  return { x: 0, width: frameWidth };
}

function contentFrameRect(page: LayoutInput["page"], margins: LayoutInput["margins"]): Rect {
  return {
    x: margins.leftPx,
    y: margins.topPx,
    width: page.widthPx - margins.leftPx - margins.rightPx,
    height: page.heightPx - margins.topPx - margins.bottomPx,
  };
}

// -----------------------------------------------------------------------------
// Line breaking (pre-measured runs)
// -----------------------------------------------------------------------------

type LineDraft = {
  runs: PlacedRun[];
  pmFrom: number;
  pmTo: number;
};

function pushPlacedSegment(
  run: StyledRun,
  measured: MeasuredDocumentSnapshot["measuredRuns"],
  text: string,
  charFrom: number,
  charTo: number,
  x: number,
  out: PlacedRun[],
): number {
  const w = runWidthPx({ ...run, text }, measured);
  const pm = pmPosAtRunOffset(run, charFrom, charTo);
  out.push({
    runId: run.id,
    text,
    font: run.font,
    marks: run.marks,
    x,
    width: w,
    pmRange: pm,
  });
  return w;
}

function breakBlockIntoLineDrafts(
  block: BlockSnapshot,
  snapshot: MeasuredDocumentSnapshot,
  contentWidth: number,
): LineDraft[] {
  const lines: LineDraft[] = [];
  const measuredRuns = snapshot.measuredRuns;

  let currentParts: PlacedRun[] = [];
  let lineWidthUsed = 0;
  let linePmFrom = Number.POSITIVE_INFINITY;
  let linePmTo = 0;

  const flushCurrentLine = () => {
    if (currentParts.length === 0) return;
    lines.push({
      runs: currentParts,
      pmFrom: linePmFrom,
      pmTo: linePmTo,
    });
    currentParts = [];
    lineWidthUsed = 0;
    linePmFrom = Number.POSITIVE_INFINITY;
    linePmTo = 0;
  };

  const appendToLine = (pr: PlacedRun, pmFrom: number, pmTo: number) => {
    currentParts.push(pr);
    lineWidthUsed += pr.width;
    linePmFrom = Math.min(linePmFrom, pmFrom);
    linePmTo = Math.max(linePmTo, pmTo);
  };

  for (const run of block.runs) {
    const pieces = run.text.split("\n");
    for (let pi = 0; pi < pieces.length; pi++) {
      if (pi > 0) flushCurrentLine();
      const piece = pieces[pi] ?? "";

      if (run.atomic) {
        if (piece.length === 0) continue;
        const placed: PlacedRun[] = [];
        const width = pushPlacedSegment(run, measuredRuns, piece, 0, piece.length, 0, placed);
        const pr = placed[0]!;
        if (lineWidthUsed > 0 && lineWidthUsed + width > contentWidth) flushCurrentLine();
        appendToLine(pr, pr.pmRange.from, pr.pmRange.to);
        continue;
      }

      let offset = 0;
      while (offset < piece.length) {
        let end = piece.length;
        let best = offset;
        while (best < end) {
          const mid = best + 1;
          const sub = piece.slice(offset, mid);
          const w = runWidthPx({ ...run, text: sub }, measuredRuns);
          if (lineWidthUsed + w > contentWidth) break;
          best = mid;
        }
        const bestBeforeWhitespaceAdjust = best;

        // Prefer breaking at the most recent whitespace when we need a soft wrap.
        if (best > offset && best < piece.length) {
          for (let i = best - 1; i > offset; i--) {
            const ch = piece[i];
            if (ch === " " || ch === "\t") {
              // Include the whitespace with the previous line so the next line
              // doesn't start with an undecorated/unstyled position.
              best = i + 1;
              break;
            }
          }
        }

        if (best === offset) {
          const sub = piece.slice(offset, offset + 1);
          const w = runWidthPx({ ...run, text: sub }, measuredRuns);
          if (lineWidthUsed > 0 && lineWidthUsed + w > contentWidth) {
            flushCurrentLine();
          }
          const placed: PlacedRun[] = [];
          pushPlacedSegment(run, measuredRuns, sub, offset, offset + 1, lineWidthUsed, placed);
          const pr = placed[0]!;
          appendToLine(pr, pr.pmRange.from, pr.pmRange.to);
          offset += 1;
        } else {
          const sub = piece.slice(offset, best);
          const placed: PlacedRun[] = [];
          const x = lineWidthUsed;
          pushPlacedSegment(run, measuredRuns, sub, offset, best, x, placed);
          const pr = placed[0]!;
          appendToLine(pr, pr.pmRange.from, pr.pmRange.to);
          offset = best;
          const wrappedAtWhitespace = best < bestBeforeWhitespaceAdjust;
          if (wrappedAtWhitespace) {
            flushCurrentLine();
          }
        }
      }
    }
  }
  if (lines.length === 0 && currentParts.length === 0) {
    const anchor = block.runs[0]?.pmRange.from ?? block.pmRange.from + 1;
    lines.push({
      runs: [],
      pmFrom: anchor,
      pmTo: anchor,
    });
  }
  flushCurrentLine();
  return lines;
}

// -----------------------------------------------------------------------------
// Widow / orphan
// -----------------------------------------------------------------------------

function linesThatFitFirstFragment(
  remainingLines: number,
  maxLinesOnPage: number,
  orphanMin: number,
  widowMin: number,
): { fit: number; reason: BreakReason | undefined } {
  if (remainingLines === 0) return { fit: 0, reason: undefined };
  const cap = Math.min(maxLinesOnPage, remainingLines);
  if (cap >= remainingLines) return { fit: remainingLines, reason: undefined };

  if (remainingLines === 1) {
    return { fit: 0, reason: undefined };
  }

  let fit = cap;
  if (fit < orphanMin && remainingLines >= orphanMin) {
    return { fit: 0, reason: "widow_orphan_protection" };
  }
  if (remainingLines - fit < widowMin) {
    const alt = remainingLines - widowMin;
    if (alt >= orphanMin) {
      return { fit: alt, reason: "widow_orphan_protection" };
    }
    if (alt > 0 && alt < orphanMin && remainingLines >= orphanMin) {
      return { fit: 0, reason: "widow_orphan_protection" };
    }
    return { fit: 0, reason: "widow_orphan_protection" };
  }
  return { fit, reason: "frame_overflow" };
}

// -----------------------------------------------------------------------------
// Mapping index
// -----------------------------------------------------------------------------

type LineRef = {
  pageIndex: number;
  frameIndex: number;
  fragmentIndex: number;
  lineIndex: number;
  pmFrom: number;
  pmTo: number;
};

function buildMappingIndex(refs: LineRef[]): MappingIndex {
  const sorted = [...refs].sort((a, b) => a.pmFrom - b.pmFrom);

  const pmPosToLayout = (pmPos: number): LayoutPoint | null => {
    for (const r of sorted) {
      if (pmPos < r.pmFrom) break;
      if (pmPos >= r.pmFrom && pmPos < r.pmTo) {
        return {
          pageIndex: r.pageIndex,
          frameIndex: r.frameIndex,
          fragmentIndex: r.fragmentIndex,
          lineIndex: r.lineIndex,
          offsetInLine: pmPos - r.pmFrom,
        };
      }
      if (pmPos === r.pmTo) {
        return {
          pageIndex: r.pageIndex,
          frameIndex: r.frameIndex,
          fragmentIndex: r.fragmentIndex,
          lineIndex: r.lineIndex,
          offsetInLine: r.pmTo - r.pmFrom,
        };
      }
    }
    return null;
  };

  const layoutToPmPos = (point: LayoutPoint): number | null => {
    const hit = refs.find(
      (r) =>
        r.pageIndex === point.pageIndex &&
        r.frameIndex === point.frameIndex &&
        r.fragmentIndex === point.fragmentIndex &&
        r.lineIndex === point.lineIndex,
    );
    if (!hit) return null;
    const o = Math.max(0, Math.min(point.offsetInLine, hit.pmTo - hit.pmFrom));
    return hit.pmFrom + o;
  };

  return { pmPosToLayout, layoutToPmPos };
}

function offsetRunsForSlot(runs: PlacedRun[], slotX: number): PlacedRun[] {
  return runs.map((r) => ({ ...r, x: r.x + slotX }));
}

// -----------------------------------------------------------------------------
// composeLayout
// -----------------------------------------------------------------------------

export function composeLayout(
  snapshot: MeasuredDocumentSnapshot,
  previous: LayoutOutput | null,
  input: LayoutInput,
): LayoutOutput {
  void previous;
  const t0 = nowMs();

  const policies = resolvePolicies(input);
  const lineHeight = input.typography.defaultLineHeightPx;
  const frame = contentFrameRect(input.page, input.margins);
  const obstacles = input.obstacles;

  const pages: PageLayout[] = [];
  const lineRefs: LineRef[] = [];

  let currentFragments: BlockFragment[] = [];
  let currentY = 0;
  let pageIndex = 0;

  const flushPage = (reasonForLastFragment?: BreakReason) => {
    if (currentFragments.length === 0) return;
    if (reasonForLastFragment !== undefined) {
      const last = currentFragments[currentFragments.length - 1]!;
      currentFragments[currentFragments.length - 1] = {
        ...last,
        breakReason: reasonForLastFragment,
      };
    }
    const frameLayout: FrameLayout = {
      bounds: { ...frame },
      fragments: currentFragments,
    };
    pages.push({
      index: pageIndex,
      spec: input.page,
      frames: [frameLayout],
    });
    pageIndex += 1;
    currentFragments = [];
    currentY = 0;
  };

  const blocks = snapshot.blocks;

  const contentWidthForBlockStart = (yInFrame: number): number => {
    const bandTop = frame.y + yInFrame;
    const bandBottom = bandTop + lineHeight;
    const slot = usableSlotForBand(frame.width, bandTop, bandBottom, obstacles, policies.minSlotWidthPx);
    return slot.width;
  };

  const estimateBlockHeight = (b: BlockSnapshot, yInFrame: number): number => {
    const w = contentWidthForBlockStart(yInFrame);
    const d = breakBlockIntoLineDrafts(b, snapshot, w);
    return d.length * lineHeight;
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]!;
    const manualBreak = block.attrs["manualPageBreakBefore"] === true;
    if (manualBreak && (currentFragments.length > 0 || currentY > 0)) {
      flushPage("manual_page_break");
    }

    const nextBlock = blocks[bi + 1];
    const keepNext =
      policies.keepWithNextEnabled &&
      block.attrs["keepWithNext"] === true &&
      nextBlock !== undefined;

    if (keepNext) {
      const h1 = estimateBlockHeight(block, currentY);
      const h2 = estimateBlockHeight(nextBlock, currentY + h1);
      const need = h1 + h2;
      const rem = frame.height - currentY;
      if (need <= frame.height && rem < need && (currentFragments.length > 0 || currentY > 0)) {
        flushPage("keep_with_next");
      }
    }

    const drafts = breakBlockIntoLineDrafts(block, snapshot, contentWidthForBlockStart(currentY));
    if (drafts.length === 0) continue;

    let lineCursor = 0;
    let fragmentIndex = 0;

    while (lineCursor < drafts.length) {
      const remaining = drafts.length - lineCursor;
      const maxLines = Math.max(0, Math.floor((frame.height - currentY) / lineHeight));
      const { fit, reason } = linesThatFitFirstFragment(
        remaining,
        Math.max(maxLines, 0),
        policies.orphanLinesMin,
        policies.widowLinesMin,
      );

      let useFit = fit;
      if (useFit === 0 && currentY > 0) {
        flushPage(reason ?? "frame_overflow");
        continue;
      }
      if (useFit === 0 && currentY === 0) {
        useFit = 1;
      }

      const chunk = drafts.slice(lineCursor, lineCursor + useFit);
      const assigned: LineBox[] = chunk.map((d, li) => {
        const y = currentY + li * lineHeight;
        const bt = frame.y + y;
        const bb = bt + lineHeight;
        const s = usableSlotForBand(frame.width, bt, bb, obstacles, policies.minSlotWidthPx);
        return {
          y,
          height: lineHeight,
          runs: offsetRunsForSlot(d.runs, s.x),
          pmRange: { from: d.pmFrom, to: d.pmTo },
        };
      });

      const pmMin = Math.min(...chunk.map((c) => c.pmFrom));
      const pmMax = Math.max(...chunk.map((c) => c.pmTo));

      const willContinue = lineCursor + useFit < drafts.length;
      const frag: BlockFragment = {
        blockId: block.id,
        fragmentIndex,
        pmRange: { from: pmMin, to: pmMax },
        lines: assigned,
        ...(willContinue ? { breakReason: reason ?? "frame_overflow" } : {}),
      };

      const frIndex = 0;
      const fragIdx = currentFragments.length;
      for (let li = 0; li < assigned.length; li++) {
        const ln = assigned[li]!;
        lineRefs.push({
          pageIndex,
          frameIndex: frIndex,
          fragmentIndex: fragIdx,
          lineIndex: li,
          pmFrom: ln.pmRange.from,
          pmTo: ln.pmRange.to,
        });
      }

      currentFragments.push(frag);
      currentY += useFit * lineHeight;
      lineCursor += useFit;
      fragmentIndex += 1;

      if (lineCursor < drafts.length) {
        flushPage();
      }
    }
  }

  flushPage();

  if (pages.length === 0) {
    pages.push({
      index: 0,
      spec: input.page,
      frames: [
        {
          bounds: { ...frame },
          fragments: [],
        },
      ],
    });
  }

  const t1 = nowMs();
  const composeMs = t1 - t0;

  const metrics: ComposeMetrics = {
    extractionMs: 0,
    measurementMs: 0,
    composeMs,
    pages: pages.length,
    blocks: blocks.length,
  };

  return {
    pages,
    mapping: buildMappingIndex(lineRefs),
    metrics,
  };
}
