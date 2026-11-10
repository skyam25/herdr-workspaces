import test from "node:test";
import assert from "node:assert/strict";
import { setup, mount, hwsCalls, textOf } from "./harness.mjs";
import { seenText, pairedText, popupSize } from "../hws-footer/phones.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// setShared lands in sharedValues, as it does in Herdr, so the footer sees what the popup sets.
function world(overrides = {}) {
  const H = setup({ sharedValues: {}, ...overrides });
  const sets = [];
  sets.push = (entry) => {
    Array.prototype.push.call(sets, entry);
    H.sharedValues[entry.key] = entry.value;
    return sets.length;
  };
  H.sharedSets = sets;
  return H;
}

const args = (H) => hwsCalls(H).map((c) => c.args.join(" "));

function findNode(el, id) {
  const node = el?.node ?? el;
  if (typeof node !== "object" || node === null) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

const device = (id, name, seenAgo, pairedAgo = 3 * DAY) => ({ id, name, lastSeen: Date.now() - seenAgo, pairedAt: Date.now() - pairedAgo });
const status = (devices, handoffs = []) => ({ running: true, pid: 1, paired: devices.length > 0, devices, handoffs });
const NO_PHONE = { running: false, paired: false, devices: [], handoffs: [] };
const POPUP = { view: "phones", overlay: "ov7" };

// The footer row

test("with no phone paired a click opens the Pair phone tab and no popup", async () => {
  const H = world({ hws: { "phone status": NO_PHONE, "phone pair": { opened: "t9" } } });
  const m = await mount("hws-footer", undefined);
  await m.click("phone");
  assert.ok(args(H).includes("phone pair --json"));
  assert.equal(H.overlays.length, 0);
  assert.match(m.view.phoneTip(), /^Pair the Agent Brief app/);
});

test("with a phone paired a click opens the Phones popup above the row", async () => {
  const H = world({ hws: { "phone status": status([device("d1", "iPhone", 30_000)]) } });
  const m = await mount("hws-footer", undefined);
  findNode(m.render(), "phone").handlers.on_mouse_down_left({ bounds: { x: 8, y: 700, width: 200, height: 28 } });
  await m.click("phone");
  assert.equal(args(H).includes("phone pair --json"), false);
  const size = popupSize(status([device("d1", "iPhone", 0)]));
  assert.deepEqual(H.overlays, [{ mod: "hws-footer", kind: "popup", ...size, at: { x: 8, y: 700 - size.height - 4 }, props: { view: "phones" } }]);
  assert.equal(m.view.phoneTip(), "iPhone paired. Click to see your paired phones");
});

test("the collapsed rail opens the same popup beside the rail", async () => {
  const H = world({
    hws: { "phone status": status([device("d1", "iPhone", 30_000)]) },
    layout: { id: "root", children: [{ id: "sidebar", size: { px: 48 } }] },
  });
  const m = await mount("hws-footer", undefined);
  assert.equal(m.text(), "", "the rail shows icons only");
  findNode(m.render(), "phone").handlers.on_mouse_down_left({ bounds: { x: 8, y: 700, width: 32, height: 28 } });
  await m.click("phone");
  const { height } = H.overlays[0];
  assert.deepEqual(H.overlays[0].at, { x: 46, y: 728 - height });
  assert.equal(H.overlays[0].props.view, "phones");
});

test("a click before the row has painted opens the popup at the pointer", async () => {
  const H = world({ hws: { "phone status": status([device("d1", "iPhone", 30_000)]) } });
  const m = await mount("hws-footer", undefined);
  await m.click("phone");
  assert.equal(H.overlays[0].at, "pointer");
});

// The Phones popup

test("one connected phone shows Connected, when it paired and the done dot", async () => {
  world({ hws: { "phone status": status([device("d1", "iPhone", 30_000, 3 * DAY)]) } });
  const m = await mount("hws-footer", POPUP);
  const text = m.text();
  assert.match(text, /^Phones \| iPhone \| Connected · Paired \w{3} \d+/);
  assert.match(text, /Listener running · Nothing waiting \| Pair another phone or iPad$/);
  const dot = findNode(m.render(), "phone-d1").children[0].node.children[0].node;
  assert.equal(dot.bg, "color:done");
  assert.ok(m.clickable("forget-d1"));
});

test("a phone seen long ago shows its seen time and no done dot", async () => {
  world({ hws: { "phone status": status([device("d1", "iPad", 10 * MINUTE, 0)]) } });
  const m = await mount("hws-footer", POPUP);
  assert.match(m.text(), /iPad \| Seen 10 minutes ago · Paired today/);
  const dot = findNode(m.render(), "phone-d1").children[0].node.children[0].node;
  assert.equal(dot.bg, undefined);
});

test("two phones each get a row and a Forget", async () => {
  world({ hws: { "phone status": status([device("d1", "iPhone", 30_000), device("d2", "iPad", 2 * DAY)]) } });
  const m = await mount("hws-footer", POPUP);
  assert.match(m.text(), /iPhone \| Connected · .* \| iPad \| Seen (2 days ago|yesterday) · /);
  assert.ok(m.clickable("forget-d1") && m.clickable("forget-d2"));
});

test("Forget asks in place, and only Forget runs hws phone forget", async () => {
  let answer = status([device("d1", "iPhone", 30_000), device("d2", "iPad", 2 * DAY)]);
  const H = world({
    hws: {
      "phone status": () => answer,
      "phone forget d2": () => {
        answer = status(answer.devices.filter((d) => d.id !== "d2"));
        return { forgotten: "iPad" };
      },
    },
  });
  const footer = await mount("hws-footer", undefined);
  assert.equal(footer.text(), "Settings | Add machine | iPhone, iPad");
  const m = await mount("hws-footer", POPUP);
  await m.click("forget-d2");
  assert.match(m.text(), /Forget iPad\? \| Cancel \| Forget/);
  assert.equal(args(H).some((a) => a.startsWith("phone forget")), false);

  await m.click("forget-d2-no");
  assert.doesNotMatch(m.text(), /Forget iPad\?/);

  await m.click("forget-d2");
  findNode(m.render(), "forget-d2-confirm").handlers.on_hover(false, m.cx);
  assert.doesNotMatch(m.text(), /Forget iPad\?/, "moving the pointer away cancels");

  await m.click("forget-d2");
  await m.click("forget-d2-yes");
  assert.ok(args(H).includes("phone forget d2 --json"));
  assert.equal(args(H).at(-1), "phone status --json", "the popup reloads after Forget");
  assert.equal(m.has("phone-d2"), false);
  assert.equal(footer.text(), "Settings | Add machine | iPhone", "the footer row follows the popup's reload");
});

test("a failed Forget says so and keeps the phone", async () => {
  world({ hws: { "phone status": status([device("d1", "iPhone", 30_000)]), "phone forget d1": { fail: "no" } } });
  const m = await mount("hws-footer", POPUP);
  await m.click("forget-d1");
  await m.click("forget-d1-yes");
  assert.match(m.text(), /Couldn't forget iPhone\./);
  assert.ok(m.has("phone-d1"));
});

test("waiting hand-offs show under the listener line, five at most", async () => {
  const handoffs = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, sessionId: `p${i}`, sessionLabel: "demo · Claude Code", page: `docs/page-${i}.html`, boardName: `ipad-h${i}`, createdAt: 1, state: "open" }));
  handoffs[1] = { id: "h1", sessionId: "p1", sessionLabel: "api · Codex", fromBoard: "flow", boardName: "ipad-h1", createdAt: 1, state: "open" };
  world({ hws: { "phone status": status([device("d1", "iPhone", 30_000)], handoffs) } });
  const m = await mount("hws-footer", POPUP);
  const text = m.text();
  assert.match(text, /Listener running · 7 waiting on the phone \| page-0\.html · demo · Claude Code \| flow · api · Codex \| page-2\.html/);
  assert.match(text, /page-4\.html · demo · Claude Code \| 2 more \| Pair another/);
  assert.doesNotMatch(text, /page-5/);
  assert.ok(popupSize(status([device("d1", "iPhone", 0)], handoffs)).height > popupSize(status([device("d1", "iPhone", 0)])).height);
});

test("no phone paired reads plainly and offers Pair a phone", async () => {
  world({ hws: { "phone status": NO_PHONE } });
  const m = await mount("hws-footer", POPUP);
  assert.equal(m.text(), "Phones | No phone is paired. | Listener not running | Pair a phone or iPad");
});

test("a failed status call says so, and the next poll recovers", async () => {
  let answer = { fail: "listener gone" };
  world({ hws: { "phone status": () => answer } });
  const m = await mount("hws-footer", POPUP);
  assert.equal(m.text(), "Phones | Couldn't read the phone status. | Pair a phone or iPad");

  answer = status([device("d1", "iPhone", 30_000)]);
  await m.fireTimer(3000);
  assert.match(m.text(), /^Phones \| iPhone \| Connected/);
  assert.doesNotMatch(m.text(), /Couldn't read/);
});

test("the popup reads status again every 3 seconds, so a new phone shows", async () => {
  let answer = status([device("d1", "iPhone", 30_000)]);
  const H = world({ hws: { "phone status": () => answer } });
  const m = await mount("hws-footer", POPUP);
  assert.equal(m.has("phone-d2"), false);
  answer = status([device("d1", "iPhone", 30_000), device("d2", "iPad", 0, 0)]);
  await m.fireTimer(3000);
  assert.ok(m.has("phone-d2"));
  assert.equal(args(H).filter((a) => a === "phone status --json").length, 2);
});

test("Pair another closes the popup and the footer pairs with its usual polling", async () => {
  let answer = status([device("d1", "iPhone", 30_000)]);
  const H = world({ hws: { "phone status": () => answer, "phone pair": { opened: "t9" } } });
  const footer = await mount("hws-footer", undefined);
  const popup = await mount("hws-footer", POPUP);
  await popup.click("phones-pair");
  assert.deepEqual(H.closed, ["ov7"]);
  assert.equal(args(H).includes("phone pair --json"), false, "the popup never pairs itself");

  footer.render();
  footer.render();
  await footer.fireTimer(0);
  assert.equal(args(H).filter((a) => a === "phone pair --json").length, 1, "one request pairs once");
  assert.equal(footer.timers.filter((t) => t.ms === 3000).length, 1);

  answer = status([device("d1", "iPhone", 30_000), device("d2", "iPad", 0, 0)]);
  await footer.fireTimer(3000);
  assert.equal(footer.text(), "Settings | Add machine | iPhone, iPad");
  assert.equal(footer.timers.find((t) => t.ms === 3000).cancelled, true);
});

test("the footer keeps its three rows and the popup draws no footer rows", async () => {
  world({ hws: { "phone status": status([device("d1", "iPhone", 30_000)]) } });
  const footer = await mount("hws-footer", undefined);
  assert.equal(footer.text(), "Settings | Add machine | iPhone");
  const popup = await mount("hws-footer", POPUP);
  assert.equal(textOf(popup.render()).includes("Settings"), false);
});

// Relative times

test("seen and paired times read in plain words", () => {
  const now = new Date(2026, 10, 9, 18, 0).getTime();
  assert.equal(seenText(now - 20_000, now), "Seen just now");
  assert.equal(seenText(now - MINUTE, now), "Seen 1 minute ago");
  assert.equal(seenText(now - 42 * MINUTE, now), "Seen 42 minutes ago");
  assert.equal(seenText(now - 61 * MINUTE, now), "Seen 1 hour ago");
  assert.equal(seenText(now - 5 * 60 * MINUTE, now), "Seen 5 hours ago");
  assert.equal(seenText(new Date(2026, 10, 8, 23, 0).getTime(), now), "Seen yesterday");
  assert.equal(seenText(now - 3 * DAY, now), "Seen 3 days ago");
  assert.equal(seenText(new Date(2026, 9, 2, 9, 0).getTime(), now), "Seen Oct 2");
  assert.equal(seenText(new Date(2025, 11, 30, 9, 0).getTime(), now), "Seen Dec 30, 2025");
  assert.equal(seenText(now + 5000, now), "Seen just now", "a clock a little ahead reads as now");
  assert.equal(pairedText(now - MINUTE, now), "Paired today");
  assert.equal(pairedText(now - DAY, now), "Paired yesterday");
  assert.equal(pairedText(new Date(2026, 10, 1).getTime(), now), "Paired Nov 1");
});
