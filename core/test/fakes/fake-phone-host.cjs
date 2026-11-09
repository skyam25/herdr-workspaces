#!/usr/bin/env node
// Stands in for the phone listener. Logs each request and answers from its arguments.
const { appendFileSync, rmSync } = require('node:fs');
const http = require('node:http');

const [socket, log, devicesJson, pairing = 'pairs'] = process.argv.slice(2);
const devices = JSON.parse(devicesJson);
rmSync(socket, { force: true });

const URL = 'agentbrief://pair/abc';
const SHEET = { url: URL, qrText: 'QR-CODE', network: 'Home' };

// The pairing argument is pairs, replaced or refused.
const pairAnswers = {
  pairs: { post: SHEET, get: { url: URL, devices: [...devices, { id: 'd9', name: 'New iPad' }] } },
  replaced: { post: SHEET, get: { devices } },
  refused: { post: { error: 'pairing is busy' }, get: { devices } },
}[pairing];

const answers = {
  'GET /status': () => ({ paired: devices.length > 0, devices, handoffs: [] }),
  'POST /handoffs': () => ({ id: 'h1', state: 'open' }),
  'POST /forget': () => ({ ok: true }),
  'POST /stop': () => ({ ok: true }),
  'POST /pair': () => pairAnswers.post,
  'GET /pair': () => pairAnswers.get,
  'DELETE /pair': () => ({ ok: true }),
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      appendFileSync(log, `${JSON.stringify({ key, body: body ? JSON.parse(body) : null })}\n`);
      const answer = answers[key];
      res.writeHead(answer ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer ? answer() : { error: 'no route' }));
    });
  })
  .listen(socket, () => process.stdout.write('ready\n'));
