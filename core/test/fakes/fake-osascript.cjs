#!/usr/bin/env node
// Logs the Finder script and moves the listed paths into FAKE_TRASH_DIR.
const { appendFileSync, mkdirSync, renameSync } = require('node:fs');
const { basename, join } = require('node:path');

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ bin: 'osascript', args: argv })}\n`);
const paths = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '-e') i += 1;
  else paths.push(argv[i]);
}
mkdirSync(process.env.FAKE_TRASH_DIR, { recursive: true });
paths.forEach((path, index) => renameSync(path, join(process.env.FAKE_TRASH_DIR, `finder-${index}-${basename(path)}`)));
