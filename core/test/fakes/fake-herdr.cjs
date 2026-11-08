#!/usr/bin/env node
// Stands in for herdr-app. Keeps its window in FAKE_STATE and logs every call.
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ bin: 'herdr-app', args: argv })}\n`);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));

function reply(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(0);
}

function fail(message) {
  process.stdout.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}

function save() {
  writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
}

function nextId() {
  state.counter += 1;
  return state.counter;
}

function newTab(name) {
  const n = nextId();
  const terminal = { terminal: `t${n}`, pane: `p${n}`, status: null, app: null, sub_agents: [] };
  return { id: `tb${n}`, name: name ?? String(n), terminals: [terminal] };
}

function flagsOf(words) {
  const flags = {};
  for (let i = 0; i < words.length; i += 2) flags[words[i].slice(2)] = words[i + 1];
  return flags;
}

const [command, action, ...rest] = argv;

if (command === 'ls') {
  if (state.lsFails) process.exit(1);
  reply({ spaces: state.spaces, recent: [] });
}

if (command === 'status') {
  if (state.statusFails) process.exit(1);
  reply({ space: state.selected });
}

if (command !== 'do') fail(`unexpected command ${command}`);
if (state.failDo?.includes(action)) fail(`${action} refused`);

const flags = flagsOf(rest);

if (action === 'space.new') {
  const tab = newTab();
  const id = `sp${nextId()}`;
  state.spaces.push({ id, name: flags.name, folder: flags.folder, tabs: [tab] });
  state.selected = id;
  save();
  reply({ space: id, tab: tab.id, terminal: tab.terminals[0].terminal });
}

if (action === 'tab.new') {
  const spaceId = flags.space ?? state.selected;
  const space = state.spaces.find((item) => item.id === spaceId);
  if (!space) fail(`no space ${spaceId}`);
  const tab = newTab(flags.name);
  space.tabs.push(tab);
  save();
  reply({ space: space.id, tab: tab.id, terminal: tab.terminals[0].terminal });
}

if (action === 'pane.split') {

  // `ls` hides chat panes, so chatPanes maps each one to its tab.
  const tabs = state.spaces.flatMap((space) => space.tabs);
  const tab =
    tabs.find((item) => item.terminals.some((terminal) => terminal.pane === flags.pane)) ??
    tabs.find((item) => item.id === state.chatPanes?.[flags.pane]);
  if (!tab) fail(`no pane ${flags.pane}`);

  const n = nextId();
  tab.terminals.push({ terminal: `t${n}`, pane: `p${n}`, status: null, app: null, sub_agents: [] });
  save();
  reply({ pane: `p${n}`, terminal: `t${n}` });
}

if (action === 'space.close') {
  state.spaces = state.spaces.filter((space) => space.id !== flags.id);
  save();
  reply({});
}

reply({});
