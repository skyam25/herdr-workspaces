// Herdr resends a pane's whole image for each change to the page, and shows the pane empty
// while the image arrives. A page in a pane therefore holds still until the person acts.

const HOVER_SETTLE_MS = 90;

const SOLID_CARET = '* { caret-animation: manual !important; }';
const NO_TRANSITIONS = '*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; }';
const REDUCED_MOTION = { name: 'prefers-reduced-motion', value: 'reduce' };

const adoptSheet = (css) =>
  `(() => { const sheet = new CSSStyleSheet(); sheet.replaceSync(${JSON.stringify(css)}); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; })()`;

// The app's page loses its caret blink and its transitions. A review page keeps its own styling
// and loses only the blink, through a sheet that leaves its DOM as the file wrote it.
function holdStill(contents) {
  contents.on('dom-ready', () => {
    contents.insertCSS(`${SOLID_CARET} ${NO_TRANSITIONS}`, { cssOrigin: 'user' }).catch(() => {});
  });
  contents.on('frame-created', (_event, { frame }) => {
    frame?.on('dom-ready', () => {
      if (frame.parent) frame.executeJavaScript(adoptSheet(SOLID_CARET)).catch(() => {});
    });
  });
}

// Adds the reduced-motion preference to the media features a page is told about.
function reduceMotion(params = {}) {
  const others = (params.features ?? []).filter((feature) => feature.name !== REDUCED_MOTION.name);
  return { ...params, features: [...others, REDUCED_MOTION] };
}

// A hover change costs a whole resend, so the page hears where the pointer is once it rests.
// A press, a drag and a wheel turn go straight through, after the position they happen at.
function settleHover(PageInput) {
  const { pointer, wheel } = PageInput.prototype;
  const resting = new WeakMap();

  const flush = (input) => {
    const held = resting.get(input);
    if (!held) return;
    clearTimeout(held.timer);
    resting.delete(input);
    pointer.call(input, held.event);
  };

  // The page may have closed by the time the pointer rests.
  const flushLater = (input) => {
    try {
      flush(input);
    } catch {}
  };

  PageInput.prototype.pointer = function settledPointer(event) {
    if (event.kind !== 'move' || this.pressed.size > 0) {
      flush(this);
      return pointer.call(this, event);
    }
    clearTimeout(resting.get(this)?.timer);
    resting.set(this, { event, timer: setTimeout(() => flushLater(this), HOVER_SETTLE_MS) });
  };

  PageInput.prototype.wheel = function settledWheel(event) {
    flush(this);
    return wheel.call(this, event);
  };
}

module.exports = { HOVER_SETTLE_MS, SOLID_CARET, NO_TRANSITIONS, REDUCED_MOTION, holdStill, reduceMotion, settleHover };
