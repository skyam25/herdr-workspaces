#!/usr/bin/env node
// Moves paths into FAKE_TRASH_DIR and logs the call.
const { appendFileSync, mkdirSync, renameSync } = require('node:fs');
const { basename, join } = require('node:path');

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ bin: 'trash', args: argv })}\n`);
mkdirSync(process.env.FAKE_TRASH_DIR, { recursive: true });
argv.forEach((path, index) => renameSync(path, join(process.env.FAKE_TRASH_DIR, `${index}-${basename(path)}`)));
