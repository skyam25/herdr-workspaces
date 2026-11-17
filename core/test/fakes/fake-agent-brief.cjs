#!/usr/bin/env node
// Stands in for surface/app/bin/agent-brief.mjs. Prints what it was given, and exits with the code after `exit`.

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  process.stdout.write(
    `${JSON.stringify({
      args,
      socket: process.env.COMPANION_SOCKET,
      session: process.env.CLAUDE_CODE_SESSION_ID,
      cwd: process.env.HWS_SURFACE_CLI_CWD,
      sessionFolder: process.env.HWS_SESSION_FOLDER,
      stdin: Buffer.concat(chunks).toString('utf8'),
    })}\n`,
  );
  process.stderr.write('fake agent-brief\n');
  const at = args.indexOf('exit');
  process.exitCode = at === -1 ? 0 : Number(args[at + 1]);
});
