import { describe, expect, it } from 'vitest';
import type { SurfaceState } from '../shared/ipc';
import { deliveryOf, pageHint } from './delivery';

const surface = (standalone: boolean): SurfaceState => ({ type: 'page', title: 'plan.md', sessionId: 'surface-s1', standalone });

describe('delivery', () => {
  it('follows the surface, including a terminal that ends', () => {
    expect(deliveryOf(undefined)).toBe('send');
    expect(deliveryOf(surface(false))).toBe('done');
    expect(deliveryOf(surface(true))).toBe('standalone');
  });

  it('names the button the footer shows under a page', () => {
    expect(pageHint('send')).toBe('Send hands Claude each comment with a picture of its element.');
    expect(pageHint('done')).toBe('Done hands Claude each comment with a picture of its element.');
    expect(pageHint('send', '2 comments')).toBe('2 comments · ⌘↩ sends with pictures');
  });

  it('names Open terminal and Copy link on a standalone page', () => {
    expect(pageHint('standalone')).toBe(
      'Open terminal starts Claude on each comment with a picture of its element, and Copy link copies a line to paste into Claude.',
    );
    expect(pageHint('standalone', '2 comments')).toBe('2 comments · Open terminal or Copy link hands them to Claude with pictures');
    expect(pageHint('standalone')).not.toMatch(/\b(Done|Send)\b/);
  });
});
