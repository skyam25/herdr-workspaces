/**
 * While a view shows, the footer's Send or Done sends what that view holds: a Feedback view's
 * decisions, or a round's answers. The newest claim wins.
 */

export interface FooterClaim {
  /** What the claim sends, which Done names beside its count. */
  holds: 'decisions' | 'answers';
  /** Decisions since the last send, or questions answered. */
  count: number;
  /** Why nothing can be sent, such as an ended session. */
  blocked?: string;
  send: () => void;
}

const claims: FooterClaim[] = [];
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};

/** Gives the footer Send to `claim` until the returned release runs. */
export function claimFooter(claim: FooterClaim): () => void {
  claims.push(claim);
  changed();
  return () => {
    const at = claims.lastIndexOf(claim);
    if (at < 0) return;
    claims.splice(at, 1);
    changed();
  };
}

export const footerClaim = (): FooterClaim | undefined => claims.at(-1);

export function subscribeFooter(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
