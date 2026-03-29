/** Stub for TypeScript only; bundlers resolve `@chenglou/pretext` to the real package. */
export function prepareWithSegments(
  _text: string,
  _font: string,
  _options?: { whiteSpace?: "normal" | "pre-wrap" },
): unknown {
  return {};
}

export function layoutNextLine(
  _prepared: unknown,
  _start: { segmentIndex: number; graphemeIndex: number },
  _maxWidth: number,
): { text: string; width: number; end: { segmentIndex: number; graphemeIndex: number } } | null {
  return null;
}
