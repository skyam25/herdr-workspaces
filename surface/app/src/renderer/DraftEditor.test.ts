import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Draft } from '../shared/ipc';
import type { Delivery } from './delivery';

// The rich editor needs a DOM, and the footer does not depend on it.
vi.mock('./editor/RichEditor', () => ({ RichEditor: () => null }));

// A server render has no store snapshot, and these stores never change.
vi.mock('./hooks', async (original) => ({ ...(await original<typeof import('./hooks')>()), useStore: <T>(store: T) => store }));

const { DraftEditor } = await import('./DraftEditor');

const store = { version: 0, subscribe: () => () => {} };
const draft: Draft = { id: 'd1', body: 'Ship it', createdAt: 1, updatedAt: 1, source: { path: 'docs/plan.md' } } as Draft;

function render(surface: boolean, delivery: Delivery) {
  const book = { ...store, changedSource: () => undefined, watchSource: () => () => {}, get: () => draft };
  const props = {
    book,
    shelf: { ...store, templates: [] },
    draft,
    tabs: [],
    onFile: () => {},
    listBoards: () => Promise.resolve([]),
    focusRequest: 0,
    onSend: () => {},
    onOpenBoard: () => {},
    onCopy: () => Promise.resolve(true),
    onCopyReference: () => {},
    voice: { ...store, aim: () => {} },
    talking: false,
    outlineHost: { readOutline: () => Promise.reject(new Error('none')) },
    surface,
    delivery,
  };
  return renderToStaticMarkup(createElement(DraftEditor, props as unknown as Parameters<typeof DraftEditor>[0]));
}

describe('draft editor footer', () => {
  it('links a board in the panel', () => {
    expect(render(false, 'send')).toContain('data-testid="draft-board"');
  });

  it('has no board chip on a surface', () => {
    expect(render(true, 'done')).not.toContain('data-testid="draft-board"');
    expect(render(true, 'standalone')).not.toContain('data-testid="draft-board"');
  });

  it('words the source line for the buttons a surface shows', () => {
    expect(render(true, 'done')).toContain('Done sends this back to Claude');
    const standalone = render(true, 'standalone');
    expect(standalone).toContain('Open terminal starts Claude on your changes');
    expect(standalone).not.toContain('Done sends');
  });
});
