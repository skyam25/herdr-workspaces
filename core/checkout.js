import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const checkout = () => process.env.HWS_CHECKOUT || fileURLToPath(new URL('../', import.meta.url));

// Runs git in the checkout and resolves to its output, or null on failure.
// A credential prompt would hang, so git may not ask for one.
export function git(args, timeout = 20_000) {
  const result = spawnSync('git', ['-C', checkout(), ...args], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Counts the commits on GitHub's main that this checkout lacks, or null when git cannot say.
export function commitsBehind() {
  if (git(['fetch', '--quiet', 'origin', 'main']) === null) return null;
  const count = git(['rev-list', '--count', 'HEAD..FETCH_HEAD']);
  return count === null ? null : Number(count);
}
