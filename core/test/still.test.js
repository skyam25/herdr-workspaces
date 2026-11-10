import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { HOVER_SETTLE_MS, SOLID_CARET, NO_TRANSITIONS, REDUCED_MOTION, holdStill, reduceMotion, settleHover } = require('../../surface/still.cjs');

function input() {
  const heard = [];
  class PageInput {
    pressed = new Set();
    pointer(event) {
      if (event.kind === 'down') this.pressed.add(event.button);
      if (event.kind === 'up') this.pressed.delete(event.button);
      heard.push(`${event.kind} ${event.x}`);
    }
    wheel(event) {
      heard.push(`wheel ${event.deltaY}`);
    }
  }
  settleHover(PageInput);
  return { page: new PageInput(), heard };
}

const move = (x) => ({ kind: 'move', button: 'none', x });

test('a pointer crossing the page reports only where it rests', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, heard } = input();

  page.pointer(move(1));
  t.mock.timers.tick(HOVER_SETTLE_MS - 1);
  page.pointer(move(2));
  page.pointer(move(3));
  t.mock.timers.tick(HOVER_SETTLE_MS - 1);
  assert.deepEqual(heard, []);

  t.mock.timers.tick(1);
  assert.deepEqual(heard, ['move 3']);

  t.mock.timers.tick(HOVER_SETTLE_MS * 2);
  assert.deepEqual(heard, ['move 3']);
});

test('a press arrives at once, after the position the pointer reached', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, heard } = input();

  page.pointer(move(4));
  page.pointer({ kind: 'down', button: 'left', x: 4 });
  assert.deepEqual(heard, ['move 4', 'down 4']);

  t.mock.timers.tick(HOVER_SETTLE_MS * 2);
  assert.deepEqual(heard, ['move 4', 'down 4']);
});

test('a drag reports every move', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, heard } = input();

  page.pointer({ kind: 'down', button: 'left', x: 1 });
  page.pointer(move(2));
  page.pointer(move(3));
  page.pointer({ kind: 'up', button: 'left', x: 3 });
  assert.deepEqual(heard, ['down 1', 'move 2', 'move 3', 'up 3']);

  page.pointer(move(9));
  assert.deepEqual(heard.length, 4);
});

test('a wheel turn scrolls what is under the pointer now', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, heard } = input();

  page.pointer(move(7));
  page.wheel({ deltaY: -1 });
  assert.deepEqual(heard, ['move 7', 'wheel -1']);
});

test('a pointer that rests after the page closed is dropped', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class PageInput {
    pressed = new Set();
    pointer() {
      throw new Error('Object has been destroyed');
    }
    wheel() {}
  }
  settleHover(PageInput);

  new PageInput().pointer(move(1));
  t.mock.timers.tick(HOVER_SETTLE_MS);
});

function contents() {
  const page = new EventEmitter();
  page.inserted = [];
  page.insertCSS = async (css, options) => {
    page.inserted.push({ css, options });
  };
  return page;
}

function frame(parent) {
  const made = new EventEmitter();
  made.parent = parent;
  made.ran = [];
  made.executeJavaScript = async (code) => {
    made.ran.push(code);
  };
  return made;
}

test("the app's page gets a solid caret and no transitions on each load", () => {
  const page = contents();
  holdStill(page);

  page.emit('dom-ready');
  page.emit('dom-ready');

  assert.equal(page.inserted.length, 2);
  assert.ok(page.inserted[0].css.includes(SOLID_CARET));
  assert.ok(page.inserted[0].css.includes(NO_TRANSITIONS));
  assert.deepEqual(page.inserted[0].options, { cssOrigin: 'user' });
});

test('a review page gets a solid caret and keeps its transitions and its DOM', () => {
  const page = contents();
  holdStill(page);
  const review = frame({});
  page.emit('frame-created', {}, { frame: review });

  review.emit('dom-ready');

  assert.equal(review.ran.length, 1);
  assert.ok(review.ran[0].includes('caret-animation: manual'));
  assert.ok(review.ran[0].includes('adoptedStyleSheets'));
  assert.ok(!review.ran[0].includes('transition'));
  assert.ok(!review.ran[0].includes('createElement'));
});

test('the top frame is left to the page-wide sheet', () => {
  const page = contents();
  holdStill(page);
  const top = frame(null);
  page.emit('frame-created', {}, { frame: top });

  top.emit('dom-ready');

  assert.deepEqual(top.ran, []);
});

test('reduced motion joins the features a page is already told about', () => {
  const scheme = { name: 'prefers-color-scheme', value: 'dark' };

  assert.deepEqual(reduceMotion(), { features: [REDUCED_MOTION] });
  assert.deepEqual(reduceMotion({ media: 'screen', features: [scheme] }), { media: 'screen', features: [scheme, REDUCED_MOTION] });
  assert.deepEqual(reduceMotion({ features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }), { features: [REDUCED_MOTION] });
});
