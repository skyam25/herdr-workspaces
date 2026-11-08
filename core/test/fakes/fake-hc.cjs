#!/usr/bin/env node
// Stands in for hc. Reads terminal facts from FAKE_STATE and logs every call.
const { appendFileSync, readFileSync } = require('node:fs');

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ bin: 'hc', args: argv })}\n`);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const [command, terminal] = argv;

if (command === 'get') {
  const info = state.hc?.[terminal];
  if (info === 'missing') {
    process.stdout.write('{"error":{"kind":"not_found","message":"no terminal"}}\n');
    process.exit(3);
  }
  const standard = {
    address: terminal,
    state: 'live',
    exit_code: null,
    pid: 4242,
    foreground: { name: 'zsh', argv: ['/bin/zsh', '-l'] },
  };
  process.stdout.write(`${JSON.stringify({ ...standard, ...info })}\n`);
  process.exit(0);
}

if (command === 'send') {
  if (state.sendFails) {
    process.stderr.write('terminal is blocked\n');
    process.exit(1);
  }
  process.exit(0);
}

process.exit(1);
