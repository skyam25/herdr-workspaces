import { describe, expect, it } from 'vitest';
import { doneLabel } from './SurfaceBar';

describe('doneLabel', () => {
  it('counts the decisions Done sends', () => {
    expect(doneLabel()).toBe('Done');
    expect(doneLabel(0)).toBe('Done');
    expect(doneLabel(1)).toBe('Done · 1 decision');
    expect(doneLabel(3)).toBe('Done · 3 decisions');
  });
});
