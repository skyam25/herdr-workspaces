// `herdr-app check` renders a mod's first state only. This copies each mod with a later
// state forced on and runs the real check on it, so a bad builder call in a dialog fails.
// Copies live in test/.forced and are removed afterwards.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forced = `${root}test/.forced`;

const MANIFEST = {
  id: "spc1", name: "checkout demo", kind: "throwaway", folder: "/Users/me/Projects/checkout", instructions: "Ship the demo",
  tabs: [{ tabId: "tb1", name: "Plan", role: "plan" }],
  terminals: [{ terminal: "t13", tabId: "tb1", sessionId: null, role: "planner" }],
  surfaces: [{ id: "s1", type: "board", title: "flow", terminal: "t13", pane: "p9" }, { id: "s2", type: "note", title: "", terminal: null, pane: "gone" }],
  artifacts: [{ id: "a1", type: "board", title: "newer", path: "/a", prompt: "/a/prompt.md", fromTerminal: "t13", createdAt: 2000 }, { id: "a2", type: "note", title: "", path: "/b", prompt: "/b/prompt.md", fromTerminal: null }],
};
const AGENT = { address: "t13", space: "spc1", tab: "tb1", status: "blocked", app: "claude-code", program: { name: "Claude Code" }, focused: true };

function live(source) {
  return source
    .replaceAll("focused()", "__focused()").replaceAll("agents()", "__agents()").replaceAll("panes()", "__panes()").replaceAll("spaces()", "__spaces()")
    .replace("this.manifests = null;", "this.manifests = [__MANIFEST];")
    .replace("refresh(cx) {", "refresh(cx) { return;")
    .replace("watch(dir, cx) {", "watch(dir, cx) { return;");
}

const LIVE_HEADER = `
const __MANIFEST = ${JSON.stringify(MANIFEST)};
const __focused = () => ({ space: "spc1", tab: "tb1", pane: "p1", terminal: "t13", cwd: "/w" });
const __agents = () => [${JSON.stringify(AGENT)}];
const __panes = () => [{ pane: "p1", terminal: "t13", tab: "tb1" }, { pane: "p9", terminal: null, tab: "tb1", mod: "x" }];
const __spaces = () => [{ id: "spc1", machine: null, tabs: [{ id: "tb1", name: "Plan", status: "blocked" }, { id: "tb2", name: "Build", status: null }] }];
`;

const VARIANTS = [
  { mod: "hws-new", name: "form", props: { step: "workspace" } },
  { mod: "hws-new", name: "form-problem", props: { step: "workspace" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "That folder does not exist.";') },
  { mod: "hws-new", name: "menu-problem", props: { overlay: "o" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "hws failed";') },
  { mod: "hws-panel", name: "toggle", props: { overlay: "o" }, patch: (s) => s.replace("cx.spawn(async () => this.toggle());", "") },
  { mod: "hws-panel", name: "decide", props: { view: "decide", name: "scratch", artifacts: MANIFEST.artifacts } },
  { mod: "hws-panel", name: "decide-problem", props: { view: "decide", artifacts: [] }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "Trash failed";') },
  { mod: "hws-panel", name: "promote", props: { view: "promote", workspace: "spc1", name: "scratch" } },
  { mod: "hws-panel", name: "promote-problem", props: { view: "promote" }, patch: (s) => s.replace("this.problem = null;", 'this.problem = "Choose a folder.";') },
  { mod: "hws-panel", name: "panel", props: {}, header: LIVE_HEADER, patch: live },
  { mod: "hws-panel", name: "panel-confirm", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.isConfirmingClose = false;", "this.isConfirmingClose = true;").replace("this.note = null;", 'this.note = { text: "Link copied.", isError: false };') },
  { mod: "hws-panel", name: "panel-outside", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.manifests = [__MANIFEST];", "this.manifests = [];") },
  { mod: "hws-panel", name: "panel-problem", props: {}, header: LIVE_HEADER, patch: (s) => live(s).replace("this.problem = null;", 'this.problem = "hws failed";') },
  { mod: "hws-new", name: "CONTROL-typo", props: { step: "workspace" }, expectFailure: true, patch: (s) => s.replace('dialogRoot(t, "hws-new-form")', 'dialogRoot(t, "hws-new-form").no_such_builder()') },
];

rmSync(forced, { recursive: true, force: true });
let failed = 0;
for (const v of VARIANTS) {
  const dir = `${forced}/${v.name}`;
  mkdirSync(dir, { recursive: true });
  cpSync(`${root}${v.mod}/hws.js`, `${dir}/hws.js`);
  cpSync(`${root}${v.mod}/mod.json`, `${dir}/mod.json`);
  let source = readFileSync(`${root}${v.mod}/main.js`, "utf8").replaceAll("props()", "__props()");
  if (v.patch) source = v.patch(source);
  writeFileSync(`${dir}/main.js`, `const __props = () => (${JSON.stringify(v.props)});\n${v.header ?? ""}${source}`);
  const r = spawnSync("herdr-app", ["check", dir], { encoding: "utf8" });
  const passed = r.status === 0;
  const ok = v.expectFailure ? !passed : passed;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${v.name}${v.expectFailure ? " (must fail)" : ""}${ok ? "" : `\n${r.stdout}${r.stderr}`}`);
}
rmSync(forced, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
