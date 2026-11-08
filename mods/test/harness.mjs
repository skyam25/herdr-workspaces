// Runs a mod's main.js against stubbed Herdr APIs. Tests read what the mod rendered,
// fire its handlers and assert the commands it ran.

import { setImmediate as tick } from "node:timers/promises";

export const HWS = "/Users/me/.local/bin/hws";

const methods = new Set();
export const usedMethods = () => [...methods];

export function element(kind, extra = {}) {
  const node = { kind, children: [], handlers: {}, ...extra };
  const proxy = new Proxy(node, {
    get(target, key) {
      if (key === "node") return target;
      if (typeof key === "symbol" || key === "then") return undefined;
      methods.add(key);
      if (key === "child") return (c) => { if (c === null || c === undefined) throw new Error("child(null)"); target.children.push(c); return proxy; };
      if (key === "children") return (list) => { if (list.some((c) => c === null || c === undefined)) throw new Error("children with null"); target.children.push(...list); return proxy; };
      if (key === "id") return (id) => { target.id = id; return proxy; };
      if (key === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
      if (key === "hover") return (fn) => { fn(element("style")); return proxy; };
      if (key === "on_click" || key === "on_key_down") return (fn) => { target.handlers[key] = fn; return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}

export function inputState(options = {}) {
  const handlers = {};
  let value = options.value ?? "";
  return {
    placeholder: options.placeholder,
    value: () => value,
    set_value: (next) => { value = next; },
    set_selected_range: () => {},
    on: (event, fn) => { handlers[event] = fn; return true; },
    focus: () => { globalThis.__herdr.focusCalls.push(options.placeholder || value); },
    type(text, cx) { value = text; handlers.change?.({}, cx); },
    submit(cx) { handlers.submit?.({}, cx); },
  };
}

const nodeOf = (el) => el?.node ?? el;

function walk(el, visit) {
  const node = nodeOf(el);
  if (typeof node !== "object" || node === null) return;
  visit(node);
  for (const c of node.children ?? []) walk(c, visit);
}

export function textOf(el) {
  const parts = [];
  const go = (e) => {
    const n = nodeOf(e);
    if (typeof n === "string") parts.push(n);
    else if (n?.children) n.children.forEach(go);
  };
  go(el);
  return parts.join(" | ");
}

function find(el, id) {
  let hit = null;
  walk(el, (n) => { if (n.id === id) hit = n; });
  return hit;
}

let generation = 0;

export function setup(overrides = {}) {
  const H = {
    props: undefined,
    focused: { space: "spc1", tab: "tb1", pane: "p1", terminal: "t1", shown: null, agent: null, cwd: "/Users/me/work" },
    agents: [],
    panes: [{ pane: "p1", terminal: "t1", tab: "tb1", focused: true }],
    spaces: [{ id: "spc1", machine: null, tabs: [{ id: "tb1", name: "Plan", status: null }] }],
    runs: [],
    overlays: [],
    closed: [],
    picks: [],
    pickResult: null,
    files: {},
    watches: [],
    watchResult: null,
    focusCalls: [],
    calls: [],
    hws: { parent: { folder: "/Users/me/Projects" } },
    missingDirs: new Set(),
    missingHwsPaths: new Set(),
    other: () => ({ code: 0, stdout: "", stderr: "" }),
    ...overrides,
  };

  H.exec = async (command, args = []) => {
    H.calls.push({ command, args });
    if (command === HWS || command === "hws") {
      if (H.missingHwsPaths.has(command)) throw new Error("spawn ENOENT");
      const key = args.filter((a) => a !== "--json").filter((a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--"))).join(" ");
      const answer = H.hws[key];
      const out = typeof answer === "function" ? answer(args) : answer;
      if (out?.fail) return { code: 1, stdout: JSON.stringify({ error: out.fail }), stderr: "" };
      return { code: 0, stdout: out === undefined ? "{}" : typeof out === "string" ? out : JSON.stringify(out), stderr: "" };
    }
    if (command === "test") return { code: H.missingDirs.has(args[1]) ? 1 : 0, stdout: "", stderr: "" };
    return H.other(command, args);
  };

  globalThis.__herdr = H;
  return H;
}

// Each hws call as its arguments.
export function hwsCalls(H) {
  return H.calls.filter((c) => c.command === HWS || c.command === "hws").map((c) => ({ args: c.args }));
}

export const settle = async () => {
  for (let i = 0; i < 30; i += 1) await tick();
};

export async function mount(mod, props, H = globalThis.__herdr) {
  H.props = props;
  generation += 1;
  const { default: ViewClass } = await import(`../${mod}/main.js?g=${generation}`);
  const view = new ViewClass();
  const timers = [];
  const cx = {
    notify() {},
    stop_propagation() {},
    focus_handle: () => ({ focus() {}, is_focused: () => false }),
    spawn: (fn) => { fn(cx); },
    timer: {
      every: (ms, fn) => { timers.push({ ms, fn, repeating: true }); },
      after: (ms, fn) => { timers.push({ ms, fn, repeating: false }); },
    },
  };
  view.init(props, cx);
  await settle();
  const render = () => view.render(cx);
  return {
    view,
    cx,
    timers,
    render,
    text: () => textOf(render()),
    has: (id) => find(render(), id) !== null,
    clickable: (id) => Boolean(find(render(), id)?.handlers.on_click),
    settle,
    async click(id) {
      const n = find(render(), id);
      if (!n) throw new Error(`no element ${id}`);
      if (!n.handlers.on_click) throw new Error(`${id} is not clickable`);
      n.handlers.on_click({}, cx);
      await settle();
    },
    async key(key, modifiers = {}) {
      const root = nodeOf(render());
      root.handlers.on_key_down({ key, modifiers }, cx);
      await settle();
    },
    async fireTimer(ms) {
      for (const t of timers.filter((x) => x.ms === ms)) t.fn(cx);
      await settle();
    },
  };
}
