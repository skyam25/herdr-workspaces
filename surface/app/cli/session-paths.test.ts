import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useFakeApp } from './testkit';

const { app, run } = useFakeApp();
const SESSION = { CLAUDE_CODE_SESSION_ID: 'surface-s1' };

/** The stand-in session lives in `project`, which the shell's folder is not. */
function project(): string {
  const root = path.join(app.dir, 'project');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  app.handler = (req) => {
    if (req.url === '/sessions/surface-s1') return { json: { sessionId: 'surface-s1', cwd: root } };
    return { json: { path: 'x', version: 'missing', title: '', kind: 'document', intent: [], sections: [], sources: [], rules: [], limitations: [], history: [], revision: 0, schema: 1, rounds: [], items: [] } };
  };
  return root;
}

const routes = () => app.seen.map((s) => decodeURIComponent(s.url));

describe('absolute paths on session verbs', () => {
  it('makes an outline path relative to the session folder', async () => {
    const root = project();
    const r = await run(['outline', 'show', path.join(root, 'docs/memo.outline.md')], '', SESSION);
    expect(r.code).toBe(0);
    expect(routes()).toContain('/sessions/surface-s1/outline?path=docs/memo.outline.md');
  });

  it('makes a behavior path relative to the session folder', async () => {
    const root = project();
    await run(['behavior', 'show', path.join(root, 'proto.html'), '--json'], '', SESSION);
    expect(routes()).toContain('/sessions/surface-s1/behavior?path=proto.html');
  });

  it('makes a feedback output relative to the session folder', async () => {
    const root = project();
    await run(['feedback', 'show', path.join(root, 'docs/page.html'), '--json'], '', SESSION);
    expect(routes()).toContain('/sessions/surface-s1/feedback?path=docs/page.html');
  });

  it('sends a relative path as it is, with no session lookup', async () => {
    project();
    await run(['outline', 'show', 'memo.outline.md'], '', SESSION);
    expect(routes()).toEqual(['/sessions/surface-s1/outline?path=memo.outline.md']);
  });

  it('refuses an absolute path outside the session folder', async () => {
    project();
    const r = await run(['behavior', 'show', '/etc/proto.html'], '', SESSION);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/outside the session's project/);
  });
});
