#!/usr/bin/env node
// Prints FAKE_PS_FILE as the process list. A missing file lists nothing.
const { existsSync, readFileSync } = require('node:fs');

const file = process.env.FAKE_PS_FILE;
if (file && existsSync(file)) process.stdout.write(readFileSync(file, 'utf8'));
