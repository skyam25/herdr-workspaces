#!/usr/bin/env node
// Logs the call. FAKE_CLAUDE_FAIL names an argument, such as uninstall, whose call exits 1.
const { appendFileSync } = require('node:fs');

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ bin: 'claude', args: argv })}\n`);
if (process.env.FAKE_CLAUDE_FAIL && argv.includes(process.env.FAKE_CLAUDE_FAIL)) {
  process.stderr.write(`${process.env.FAKE_CLAUDE_FAIL} failed\n`);
  process.exit(1);
}
