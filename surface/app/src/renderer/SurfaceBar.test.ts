import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SurfaceState } from '../shared/ipc';
import { doneLabel, MoveMenu, saveControl, SurfaceBar } from './SurfaceBar';

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

const surface = (over: Partial<SurfaceState> = {}): SurfaceState => ({
  type: 'board',
  title: 'flow',
  sessionId: 'surface-s1',
  standalone: false,
  shown: 'pane',
  workspace: { id: 'w1', name: 'demo' },
  recentDays: 7,
  ...over,
});

const noop = () => {};
const bar = (over: Partial<SurfaceState> = {}) =>
  renderToStaticMarkup(
    createElement(SurfaceBar, {
      surface: surface(over),
      mic: createElement('button', { 'data-testid': 'mic' }),
      onDone: noop,
      onAct: noop,
      onSave: noop,
      onTargets: () => Promise.resolve({ current: null, suggested: null, workspaces: [] }),
      onSaveTo: noop,
    }),
  );

describe('saveControl', () => {
  it('is hidden on questions and in a web view', () => {
    expect(saveControl(surface({ type: 'questions' }))).toBeUndefined();
    expect(saveControl(surface({ web: true }))).toBeUndefined();
    for (const type of ['board', 'note', 'page'] as const) expect(saveControl(surface({ type }))).toBeDefined();
  });

  it('saves an unsaved surface and clears Saved on a saved one', () => {
    expect(saveControl(surface())).toMatchObject({ label: 'Save', click: 'save', disabled: false });
    expect(saveControl(surface({ saved: true }))).toMatchObject({ label: 'Saved', click: 'unsave', disabled: false });
  });

  it('opens the workspaces on an Unfiled window, and asks for a pop in a pane', () => {
    const unfiled = { id: 'standalone', name: '' };
    expect(saveControl(surface({ workspace: unfiled, shown: 'window' }))).toMatchObject({ label: 'Save', click: 'menu', disabled: false });
    expect(saveControl(surface({ workspace: unfiled, shown: 'window', standalone: true }))).toMatchObject({ click: 'menu' });
    const pane = saveControl(surface({ workspace: unfiled }));
    expect(pane).toMatchObject({ click: 'menu', disabled: true });
    expect(pane?.title).toMatch(/^Pop it out to save it to a workspace\./);
  });

  it('clears Saved on an Unfiled surface that is already saved', () => {
    expect(saveControl(surface({ workspace: { id: 'standalone', name: '' }, saved: true }))).toMatchObject({ label: 'Saved', click: 'unsave' });
  });

  it('waits while the surface is busy or delivered', () => {
    expect(saveControl(surface({ busy: true }))?.disabled).toBe(true);
    expect(saveControl(surface({ delivered: true, saved: true }))?.disabled).toBe(true);
  });

  it('says when unsaved work goes to the Trash', () => {
    expect(saveControl(surface())?.title).toContain('Unsaved work goes to the Trash 7 days after its terminal ends.');
    expect(saveControl(surface({ recentDays: 14, saved: true }))?.title).toContain('Trash 14 days after');
    expect(saveControl(surface({ recentDays: 1 }))?.title).toContain('Trash 1 day after');
    expect(saveControl(surface({ recentDays: 0.5 }))?.title).toContain('Trash 1 day after');
  });
});

describe('SurfaceBar', () => {
  it('puts Save before the mic', () => {
    const html = bar();
    expect(html).toContain('data-testid="surface-save"');
    expect(html.indexOf('surface-save')).toBeLessThan(html.indexOf('data-testid="mic"'));
    expect(html).toContain('>Save</span>');
  });

  it('shows Saved with a check', () => {
    const html = bar({ saved: true });
    expect(html).toContain('>Saved</span>');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<path d="M20 6 9 17l-5-5"');
  });

  it('has no Save on questions or in a web view', () => {
    expect(bar({ type: 'questions' })).not.toContain('surface-save');
    expect(bar({ web: true })).not.toContain('surface-save');
  });

  it('marks the Unfiled Save as a menu', () => {
    expect(bar({ workspace: { id: 'standalone', name: '' }, shown: 'window' })).toContain('aria-haspopup="menu"');
    expect(bar()).not.toContain('aria-haspopup');
  });
});

describe('MoveMenu', () => {
  it('takes the title Save gives it', () => {
    const props = { align: 'end' as const, onTargets: () => new Promise<never>(noop), onMove: noop, onClose: noop };
    const saving = renderToStaticMarkup(createElement(MoveMenu, { ...props, title: 'Save to a workspace' }));
    expect(saving).toContain('aria-label="Save to a workspace"');
    expect(saving).toContain('<h3 class="move-title">Save to a workspace</h3>');
    expect(saving).toContain('popover-panel up end move-menu');
    expect(renderToStaticMarkup(createElement(MoveMenu, { ...props, align: 'start' }))).toContain('aria-label="Move to workspace"');
  });
});
