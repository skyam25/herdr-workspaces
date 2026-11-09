import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { terminalInfo } from './herdr.js';
import { claudeHome, home } from './paths.js';
import { agentArgv } from './settings.js';

// Claude resumes on the person's default model unless told, so a worker's model goes with it.
// Both tools take an optional first message after the session id.
export function resumeArgv({ tool, id, model, effort }, message) {
  const argv = tool === 'codex' ? ['codex', 'resume', id] : [...(model ? agentArgv({ tool, model, effort }) : ['claude']), '--resume', id];
  return message ? [...argv, message] : argv;
}

function claudeSessionOfProcess(pid) {
  try {
    return JSON.parse(readFileSync(join(claudeHome(), 'sessions', `${pid}.json`), 'utf8')).sessionId ?? null;
  } catch {
    return null;
  }
}

// Codex names no process-to-session link, so one thread started here since the terminal opened must be it.
function codexSessionInFolder(folder, since) {
  const database = join(process.env.CODEX_HOME || join(home(), '.codex'), 'state_5.sqlite');
  const quoted = folder.replaceAll("'", "''");
  const query = `select id from threads where cwd='${quoted}' and originator='codex-tui' and created_at_ms>=${Number(since)}`;
  const result = spawnSync('sqlite3', ['-readonly', database, query], { encoding: 'utf8', timeout: 2000 });
  const ids = result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : [];
  return ids.length === 1 ? ids[0] : null;
}

// Names the session running in a terminal, or null when nothing identifies it for certain.
export function sessionOfTerminal(terminal) {
  const info = terminalInfo(terminal);
  const running = info?.foreground;
  if (!running?.cwd) return null;
  const program = String(running.argv?.[0] ?? '').split('/').pop();
  const lookup = { claude: () => claudeSessionOfProcess(running.pid), codex: () => codexSessionInFolder(running.cwd, info.created_ms) }[program];
  const id = lookup?.();
  return id ? { tool: program, id, folder: running.cwd } : null;
}

// An agent's own shell names its session, so no lookup can pick the wrong one.
export function callerSession() {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return null;
  const id = process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_THREAD_ID;
  if (!id) return null;
  const tool = process.env.CLAUDE_CODE_SESSION_ID ? 'claude' : 'codex';
  return { tool, id, folder: terminalInfo(terminal)?.foreground?.cwd ?? process.cwd() };
}
