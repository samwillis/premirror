export type PageViewportProps = {
  pageCount: number;
};

export function buildViewportLabel(props: PageViewportProps): string {
  return `pages:${props.pageCount}`;
}
