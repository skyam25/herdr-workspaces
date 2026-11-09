import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { guardCellZoom, startAtActualSize } = require('../../surface/zoom-guard.cjs');

function follower(next) {
  class Follower {
    ratio() {
      return next;
    }
  }
  guardCellZoom(Follower);
  return new Follower();
}

test('a pane shown for the first time keeps its zoom', () => {
  assert.equal(follower(2.3888).ratio({}), null);
  assert.equal(follower(0.4).ratio({}), null);
});

test('a text-size step still zooms the page', () => {
  assert.equal(follower(1.1).ratio({}), 1.1);
  assert.equal(follower(0.9).ratio({}), 0.9);
});

test('a surface resets a saved zoom once its real page loads, and only once', () => {
  const contents = new EventEmitter();
  const zooms = [];
  let url = 'about:blank';
  contents.getURL = () => url;
  contents.setZoomFactor = (factor) => zooms.push(factor);
  startAtActualSize(contents);

  contents.emit('did-finish-load');
  assert.deepEqual(zooms, []);

  url = 'file:///app/index.html';
  contents.emit('did-finish-load');
  contents.emit('did-finish-load');
  assert.deepEqual(zooms, [1]);
});

test('no change stays no change', () => {
  assert.equal(follower(null).ratio({}), null);
});
