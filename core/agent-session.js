import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { terminalInfo } from './herdr.js';
import { home } from './paths.js';

const RESUME_ARGV = {
  claude: (id) => ['claude', '--resume', id],
  codex: (id) => ['codex', 'resume', id],
};

// Claude resumes on the person's default model unless told, so a worker's model goes with it.
// Both tools take an optional first message after the session id.
export function resumeArgv({ tool, id, model, effort }, message) {
  const [program, ...rest] = RESUME_ARGV[tool](id);
  const chosen = tool === 'claude' && model ? ['--model', model, '--effort', effort] : [];
  return [program, ...chosen, ...rest, ...(message ? [message] : [])];
}

function claudeSessionOfProcess(pid) {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home(), '.claude');
  try {
    return JSON.parse(readFileSync(join(claudeHome, 'sessions', `${pid}.json`), 'utf8')).sessionId ?? null;
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
  if (program === 'claude') {
    const id = claudeSessionOfProcess(running.pid);
    return id ? { tool: 'claude', id, folder: running.cwd } : null;
  }
  if (program === 'codex') {
    const id = codexSessionInFolder(running.cwd, info.created_ms);
    return id ? { tool: 'codex', id, folder: running.cwd } : null;
  }
  return null;
}

// An agent's own shell names its session, so no lookup can pick the wrong one.
export function callerSession() {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return null;
  const tool = process.env.CLAUDE_CODE_SESSION_ID ? 'claude' : process.env.CODEX_THREAD_ID ? 'codex' : null;
  if (!tool) return null;
  const id = process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_THREAD_ID;
  return { tool, id, folder: terminalInfo(terminal)?.foreground?.cwd ?? process.cwd() };
}
