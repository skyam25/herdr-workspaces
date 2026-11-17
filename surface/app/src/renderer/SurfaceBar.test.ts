import { describe, expect, it } from 'vitest';
import { doneLabel } from './SurfaceBar';

describe('doneLabel', () => {
  it('counts the decisions or answers Done sends', () => {
    expect(doneLabel()).toBe('Done');
    expect(doneLabel({ holds: 'answers', count: 0 })).toBe('Done');
    expect(doneLabel({ holds: 'decisions', count: 1 })).toBe('Done · 1 decision');
    expect(doneLabel({ holds: 'decisions', count: 3 })).toBe('Done · 3 decisions');
    expect(doneLabel({ holds: 'answers', count: 1 })).toBe('Done · 1 answer');
    expect(doneLabel({ holds: 'answers', count: 2 })).toBe('Done · 2 answers');
  });
});
