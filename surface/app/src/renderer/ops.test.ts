import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { describe, expect, it, vi } from 'vitest';
import { ARROW_GAP } from '../board/geometry';
import { PALETTE } from '../board/palette';
import type { Skeleton } from '../protocol';
import { drawElements, randomId, removeElements, updateElements } from './ops';

type El = ExcalidrawElement;
type Fields = Record<string, any>;

const CHAR_WIDTH = 10;
const LINE_HEIGHT = 25;

// Excalidraw needs a DOM to measure text, so the stub gives each character and line a fixed size.
vi.mock('@excalidraw/excalidraw', () => {
  const measured = (text: string) => ({
    text,
    originalText: text,
    width: Math.max(...text.split('\n').map((line) => line.length)) * 10,
    height: text.split('\n').length * 25,
  });
  const convert = ({ label, ...skel }: Fields): Fields[] => {
    const size = skel.type === 'text' ? measured(skel.text) : {};
    const element: Fields = { x: 0, y: 0, width: 0, height: 0, boundElements: [], version: 1, ...skel, ...size };
    if (!label) return [element];
    const textId = `${skel.id}-label`;
    element.boundElements = [{ id: textId, type: 'text' }];
    const text = { type: 'text', id: textId, containerId: skel.id, x: element.x, y: element.y, fontSize: 20, fontFamily: 5, lineHeight: 1.25, version: 1, ...measured(label.text) };
    return [element, text];
  };
  return {
    newElementWith: (el: Fields, patch: Fields) => ({ ...el, version: el.version + 1, ...patch }),
    convertToExcalidrawElements: (skeletons: Fields[]) => skeletons.flatMap(convert),
  };
});

const shape = (id: string, type: string, x: number, y: number, width: number, height: number, extra: Fields = {}) =>
  ({ id, type, x, y, width, height, version: 1, boundElements: [], frameId: null, isDeleted: false, ...extra }) as unknown as El;
const rect = (id: string, x = 0, y = 0, width = 100, height = 50, extra: Fields = {}) => shape(id, 'rectangle', x, y, width, height, extra);
const frame = (id: string, x = 0, y = 0, width = 100, height = 100, extra: Fields = {}) => shape(id, 'frame', x, y, width, height, extra);
const boundText = (id: string, containerId: string, text: string, extra: Fields = {}) =>
  shape(id, 'text', 0, 0, text.length * CHAR_WIDTH, LINE_HEIGHT, { containerId, text, originalText: text, fontSize: 20, fontFamily: 5, ...extra });

const arrowBetween = (id: string, start: string | null, end: string | null, extra: Fields = {}) =>
  shape(id, 'arrow', 100, 25, 200, 0, {
    points: [[0, 0], [200, 0]],
    startBinding: start ? { elementId: start } : null,
    endBinding: end ? { elementId: end } : null,
    ...extra,
  });

const find = (elements: readonly El[], id: string) => elements.find((e) => e.id === id) as unknown as Fields;

const draw = (elements: readonly El[], skeletons: Skeleton[], now = 42) => drawElements(elements, { elements: skeletons } as never, 'batch', now);
const update = (elements: readonly El[], updates: Fields[]) => updateElements(elements, { updates } as never, 'batch');
const remove = (elements: readonly El[], ids: string[]) => removeElements(elements, { ids } as never, 'batch');

const COLOR = Object.keys(PALETTE)[0] as keyof typeof PALETTE;

describe('randomId', () => {
  it('makes a 12 character lowercase id', () => {
    expect(randomId()).toMatch(/^[0-9a-z]{12}$/);
  });
});

describe('drawElements', () => {
  it('stamps each new element with the batch', () => {
    const { next, response } = draw([], [{ type: 'rectangle', id: 'r', x: 0, y: 0 }]);

    expect(find(next, 'r').customData).toEqual({ by: 'claude', batchId: 'batch', createdAt: 42 });
    expect(response).toMatchObject({ ids: ['r'], batchId: 'batch' });
    expect(response.warnings).toBeUndefined();
  });

  it('marks a sticky so it reads back as one', () => {
    const { next, response } = draw([], [{ type: 'sticky', id: 's', x: 0, y: 0 }]);

    expect(find(next, 's').customData).toMatchObject({ kind: 'sticky', sticky: true });
    expect(response.elements?.[0].type).toBe('sticky');
  });

  it('binds an arrow to new and existing shapes and leaves the existing element unchanged', () => {
    const existing = rect('a');

    const { next } = draw([existing], [
      { type: 'rectangle', id: 'b', x: 300, y: 0, width: 100, height: 50 },
      { type: 'arrow', id: 'link', start: { id: 'a' }, end: { id: 'b' } },
    ]);

    expect(find(next, 'link').startBinding).toEqual({ elementId: 'a', focus: 0, gap: ARROW_GAP });
    expect(find(next, 'link').endBinding).toEqual({ elementId: 'b', focus: 0, gap: ARROW_GAP });
    expect(find(next, 'a').boundElements).toEqual([{ id: 'link', type: 'arrow' }]);
    expect(find(next, 'b').boundElements).toEqual([{ id: 'link', type: 'arrow' }]);
    expect(find(next, 'a').version).toBe(2);
    expect(existing.boundElements).toEqual([]);
  });

  it('fits an unplaced frame around its shapes with padding', () => {
    const { next, response } = draw([], [
      { type: 'frame', id: 'f', label: 'Area' },
      { type: 'rectangle', id: 'r', x: 100, y: 100, width: 200, height: 100, frameId: 'f' },
    ]);

    expect(find(next, 'f')).toMatchObject({ x: 70, y: 70, width: 260, height: 160 });
    expect(find(next, 'r').frameId).toBe('f');
    expect(response.warnings).toBeUndefined();
  });

  it('grows a box to hold its label and centers the label', () => {
    const { next } = draw([], [{ type: 'rectangle', id: 'r', x: 0, y: 0, width: 200, height: 40, label: 'one\ntwo\nthree' }]);

    expect(find(next, 'r').height).toBe(107);
    expect(find(next, 'r-label')).toMatchObject({ y: 16, height: 75, originalText: 'one\ntwo\nthree' });
  });

  it('warns when a grown box now covers its neighbour', () => {
    const { response } = draw([rect('below', 0, 80, 100, 20)], [{ type: 'rectangle', id: 'r', x: 0, y: 0, width: 200, height: 40, label: 'one\ntwo\nthree' }]);

    expect(response.warnings).toEqual(['rectangle r grew from 40 to 107 px tall to hold its label and now overlaps below. Move it down at least 47 px with update, or give r more width.']);
  });

  it('says when a placed frame grew', () => {
    const { next, response } = draw([], [
      { type: 'frame', id: 'f', x: 0, y: 0, width: 100, height: 100 },
      { type: 'rectangle', id: 'r', x: 50, y: 50, width: 200, height: 100, frameId: 'f' },
    ]);

    expect(find(next, 'f')).toMatchObject({ width: 280, height: 180 });
    expect(response.warnings).toEqual(['frame f grew to 280×180 to hold its contents.']);
  });

  it('warns when a grown frame covers another frame', () => {
    const { response } = draw([frame('other', 200, 0, 100, 50)], [
      { type: 'frame', id: 'f', x: 0, y: 0, width: 100, height: 100 },
      { type: 'rectangle', id: 'r', x: 50, y: 50, width: 200, height: 100, frameId: 'f' },
    ]);

    expect(response.warnings).toEqual(['frame f grew to 280×180 to hold its contents and now overlaps other. Move it down at least 220 px with update. A frame moves with everything in it.']);
  });

  it('grows a frame already on the board', () => {
    const { next, response } = draw([frame('f')], [{ type: 'rectangle', id: 'r', x: 50, y: 50, width: 200, height: 100, frameId: 'f' }]);

    expect(find(next, 'f')).toMatchObject({ width: 280, height: 180, version: 2 });
    expect(response.warnings).toEqual(['frame f grew to 280×180 to hold its contents.']);
  });

  it('warns when an arrow is too short to show around its label', () => {
    const { response } = draw([rect('a'), rect('b', 130)], [{ type: 'arrow', id: 'link', start: { id: 'a' }, end: { id: 'b' }, label: 'long label text' }]);

    expect(response.warnings).toHaveLength(1);
    expect(response.warnings![0]).toMatch(/^arrow link is \d+ px long, so its label "long label text" hides it\. Move the shapes it joins at least \d+ px further apart\.$/);
  });

  it('accepts a long arrow with a short label without warning', () => {
    const { response } = draw([rect('a'), rect('b', 600)], [{ type: 'arrow', id: 'link', start: { id: 'a' }, end: { id: 'b' }, label: 'ok' }]);

    expect(response.warnings).toBeUndefined();
  });
});

describe('updateElements', () => {
  it('reports only the elements it changed', () => {
    const elements = [rect('a'), boundText('label', 'a', 'hi'), rect('gone', 0, 0, 10, 10, { isDeleted: true })];

    const { next, response } = update(elements, [
      { id: 'missing', x: 1 },
      { id: 'label', x: 1 },
      { id: 'gone', x: 1 },
    ]);

    expect(response.ids).toEqual([]);
    expect(next).toEqual(elements);
  });

  it('moves and resizes a shape and bumps its version once', () => {
    const { next, response } = update([rect('a')], [{ id: 'a', x: 40, y: 60, width: 300, height: 90 }]);

    expect(find(next, 'a')).toMatchObject({ x: 40, y: 60, width: 300, height: 90, version: 2 });
    expect(response).toEqual({ ids: ['a'], batchId: 'batch' });
  });

  it('moves everything inside a moved frame', () => {
    const { next } = update([frame('f'), rect('kid', 10, 20, 50, 50, { frameId: 'f' }), rect('outside', 500, 500)], [{ id: 'f', x: 100, y: 200 }]);

    expect(find(next, 'kid')).toMatchObject({ x: 110, y: 220 });
    expect(find(next, 'outside')).toMatchObject({ x: 500, y: 500, version: 1 });
  });

  it('ignores a size on an arrow, whose points define it', () => {
    const { next } = update([arrowBetween('link', null, null)], [{ id: 'link', width: 999, height: 999 }]);

    expect(find(next, 'link')).toMatchObject({ width: 200, height: 0 });
  });

  it('recolors a sticky fill and stroke, and only the stroke of a plain shape', () => {
    const sticky = rect('s', 0, 0, 100, 100, { customData: { kind: 'sticky' }, backgroundColor: '#000', strokeColor: '#000' });
    const plain = rect('p', 0, 0, 100, 100, { backgroundColor: '#000', strokeColor: '#000' });

    const { next } = update([sticky, plain], [{ id: 's', color: COLOR }, { id: 'p', color: COLOR }]);

    expect(find(next, 's')).toMatchObject({ backgroundColor: PALETTE[COLOR].fill, strokeColor: PALETTE[COLOR].stroke });
    expect(find(next, 'p')).toMatchObject({ backgroundColor: '#000', strokeColor: PALETTE[COLOR].stroke });
  });

  it('renames a frame', () => {
    const { next } = update([frame('f')], [{ id: 'f', label: 'Checkout' }]);

    expect(find(next, 'f').name).toBe('Checkout');
  });

  it('measures free text again when it changes', () => {
    const { next } = update([shape('t', 'text', 0, 0, 10, 25, { text: 'a', originalText: 'a' })], [{ id: 't', label: 'hello\nyou' }]);

    expect(find(next, 't')).toMatchObject({ text: 'hello\nyou', originalText: 'hello\nyou', width: 50, height: 50 });
  });

  it('gives an unlabelled box a new bound label', () => {
    const { next } = update([rect('a', 0, 0, 200, 100, { frameId: 'f' })], [{ id: 'a', label: 'Login' }]);

    const [{ id }] = find(next, 'a').boundElements;
    expect(find(next, id)).toMatchObject({ containerId: 'a', frameId: 'f', originalText: 'Login', textAlign: 'center', customData: { by: 'claude', batchId: 'batch' } });
  });

  it('keeps an existing label centered in its moved box', () => {
    const box = rect('a', 0, 0, 200, 100, { boundElements: [{ id: 'label', type: 'text' }] });

    const { next } = update([box, boundText('label', 'a', 'Login')], [{ id: 'a', x: 500, y: 300 }]);

    // The box insets its label by 11 on top of Excalidraw's own 5.
    expect(find(next, 'label')).toMatchObject({ x: 511, y: 337.5, originalText: 'Login' });
  });

  it('warns when a new label makes a box cover its neighbour', () => {
    const { next, response } = update([rect('a', 0, 0, 200, 40), rect('below', 0, 80, 100, 20)], [{ id: 'a', label: 'one\ntwo\nthree' }]);

    expect(find(next, 'a').height).toBe(107);
    expect(response.warnings).toEqual(['rectangle a grew from 40 to 107 px tall to hold its label and now overlaps below. Move it down at least 47 px with update, or give a more width.']);
  });

  it('reroutes an arrow bound to a moved shape', () => {
    const { next } = update([rect('a'), rect('b', 300), arrowBetween('link', 'a', 'b')], [{ id: 'b', y: 400 }]);

    const link = find(next, 'link');
    expect(link.points[1][1]).toBeGreaterThan(0);
    expect(link.height).toBe(Math.abs(link.points[1][1]));
    expect(link.version).toBe(2);
  });

  it('keeps the free end of a half-bound arrow where it was', () => {
    const { next } = update([rect('a'), arrowBetween('link', 'a', null)], [{ id: 'a', y: 400 }]);

    const link = find(next, 'link');
    expect([link.x + link.points[1][0], link.y + link.points[1][1]]).toEqual([300, 25]);
  });

  it('moves an arrow label along with its rerouted arrow', () => {
    const arrow = arrowBetween('link', 'a', 'b', { boundElements: [{ id: 'label', type: 'text' }] });

    const { next } = update([rect('a'), rect('b', 300), arrow, boundText('label', 'link', 'hi')], [{ id: 'b', y: 400 }]);

    expect(find(next, 'label').version).toBe(2);
  });

  it('does not reroute an arrow that the same update moved', () => {
    const { next } = update([rect('a'), rect('b', 300), arrowBetween('link', 'a', 'b')], [{ id: 'b', y: 400 }, { id: 'link', x: 5, y: 6 }]);

    expect(find(next, 'link')).toMatchObject({ x: 5, y: 6, points: [[0, 0], [200, 0]] });
  });

  it('leaves an arrow alone when nothing it binds has moved', () => {
    const arrow = arrowBetween('link', 'a', 'b');

    const { next } = update([rect('a'), rect('b', 300), rect('c', 900), arrow], [{ id: 'c', y: 400 }]);

    expect(find(next, 'link')).toBe(arrow);
  });
});

describe('removeElements', () => {
  it('removes a shape and its bound label', () => {
    const box = rect('a', 0, 0, 100, 50, { boundElements: [{ id: 'label', type: 'text' }] });

    const { next, response } = remove([box, boundText('label', 'a', 'hi')], ['a']);

    expect(find(next, 'a').isDeleted).toBe(true);
    expect(find(next, 'label').isDeleted).toBe(true);
    expect(response).toEqual({ ids: ['a'], batchId: 'batch' });
  });

  it('removes what is in a frame, including labels', () => {
    const kid = rect('kid', 10, 10, 50, 50, { frameId: 'f', boundElements: [{ id: 'label', type: 'text' }] });

    const { next } = remove([frame('f'), kid, boundText('label', 'kid', 'hi', { frameId: 'f' }), rect('outside', 500)], ['f']);

    expect(['f', 'kid', 'label'].map((id) => find(next, id).isDeleted)).toEqual([true, true, true]);
    expect(find(next, 'outside').isDeleted).toBe(false);
  });

  it('detaches arrows from a removed shape and keeps the arrow', () => {
    const { next } = remove([rect('a'), rect('b', 300), arrowBetween('link', 'a', 'b')], ['a']);

    expect(find(next, 'link')).toMatchObject({ isDeleted: false, startBinding: null, endBinding: { elementId: 'b' } });
  });

  it('drops a removed arrow from the shapes it joined', () => {
    const start = rect('a', 0, 0, 100, 50, { boundElements: [{ id: 'link', type: 'arrow' }, { id: 'keep', type: 'arrow' }] });

    const { next } = remove([start, arrowBetween('link', 'a', null)], ['link']);

    expect(find(next, 'a').boundElements).toEqual([{ id: 'keep', type: 'arrow' }]);
  });

  it('ignores ids that are unknown or already deleted, and returns untouched elements as they were', () => {
    const gone = rect('gone', 0, 0, 10, 10, { isDeleted: true });
    const other = rect('other');

    const { next, response } = remove([gone, other], ['missing', 'gone']);

    expect(response.ids).toEqual([]);
    expect(next[0]).toBe(gone);
    expect(next[1]).toBe(other);
  });
});
