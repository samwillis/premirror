import type { PagePreset } from "@premirror/core";

export type ComposeInput = {
  preset: PagePreset;
};

export function composePages(input: ComposeInput): string {
  return `compose:${input.preset}`;
}
