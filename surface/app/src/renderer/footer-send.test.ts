import { describe, expect, it, vi } from 'vitest';
import { claimFooter, footerClaim, subscribeFooter } from './footer-send';

describe('footer send', () => {
  it('hands the footer Send to the newest claim and tells subscribers', () => {
    const heard = vi.fn();
    const off = subscribeFooter(heard);
    const side = { holds: 'decisions' as const, count: 1, send: () => undefined };
    const full = { holds: 'answers' as const, count: 3, send: () => undefined };
    expect(footerClaim()).toBeUndefined();
    const releaseSide = claimFooter(side);
    const releaseFull = claimFooter(full);
    expect(footerClaim()).toBe(full);
    releaseFull();
    expect(footerClaim()).toBe(side);
    releaseSide();
    expect(footerClaim()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(4);
    off();
  });
});
