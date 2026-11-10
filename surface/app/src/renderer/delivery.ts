import type { SurfaceState } from '../shared/ipc';

/**
 * How the open note or page leaves the panel. The panel has Send. A surface with a
 * terminal has Done, and a standalone surface has Open terminal and Copy link.
 */
export type Delivery = 'send' | 'done' | 'standalone';

export const deliveryOf = (surface: SurfaceState | undefined): Delivery => (!surface ? 'send' : surface.standalone ? 'standalone' : 'done');

/** The line under a page's comments. `counted` names the comments when there are any. */
export function pageHint(delivery: Delivery, counted?: string): string {
  if (delivery === 'standalone') {
    return counted
      ? `${counted} · Open terminal or Copy link hands them to Claude with pictures`
      : 'Open terminal starts Claude on each comment with a picture of its element, and Copy link copies a line to paste into Claude.';
  }
  const button = delivery === 'done' ? 'Done' : 'Send';
  return counted ? `${counted} · ⌘↩ sends with pictures` : `${button} hands Claude each comment with a picture of its element.`;
}
