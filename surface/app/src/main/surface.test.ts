import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleSignature, openRequest, prepareBundle, sessionCwd, surfaceFromEnv, type SurfaceConfig } from './surface';

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'surface-')));

const config = (over: Partial<SurfaceConfig> = {}): SurfaceConfig => ({
  id: 's1',
  type: 'board',
  title: 'flow',
  file: '',
  terminal: 't1',
  folder: '/nowhere',
  dataDir: '/data',
  hws: 'hws',
  ...over,
});

describe('surfaceFromEnv', () => {
  it('is off without a surface id', () => {
    expect(surfaceFromEnv({})).toBeUndefined();
  });

  it('resolves a relative file against the workspace folder', () => {
    const cfg = surfaceFromEnv({ HWS_SURFACE_ID: 's1', HWS_SURFACE_TYPE: 'note', HWS_SURFACE_FILE: 'docs/a.md', HWS_FOLDER: '/work' });
    expect(cfg).toMatchObject({ type: 'note', file: '/work/docs/a.md', title: 'note', terminal: '' });
  });

  it('keeps a local URL as it is', () => {
    const cfg = surfaceFromEnv({ HWS_SURFACE_ID: 's1', HWS_SURFACE_TYPE: 'page', HWS_SURFACE_FILE: 'http://localhost:5173/', HWS_FOLDER: '/work' });
    expect(cfg?.file).toBe('http://localhost:5173/');
  });
});

describe('sessionCwd and openRequest', () => {
  it('puts a board in the data folder', () => {
    expect(sessionCwd(config())).toBe('/data/work');
    expect(openRequest(config(), 'x', '/data/work')).toEqual({ sessionId: 'x', board: 'flow' });
  });

  it('opens a note with no file as a new note', () => {
    expect(openRequest(config({ type: 'note' }), 'x', '/data/work')).toEqual({ sessionId: 'x', mode: 'write' });
  });

  it('keeps a file under the workspace relative to the workspace', () => {
    const folder = temp();
    mkdirSync(join(folder, 'docs'));
    const file = join(folder, 'docs/a.md');
    writeFileSync(file, 'x');
    const cfg = config({ type: 'note', file, folder });
    expect(sessionCwd(cfg)).toBe(folder);
    expect(openRequest(cfg, 'x', sessionCwd(cfg))).toEqual({ sessionId: 'x', output: { path: 'docs/a.md' } });
  });

  it('uses the file folder for a file outside the workspace or under a home-folder default', () => {
    const elsewhere = temp();
    const file = join(elsewhere, 'a.html');
    writeFileSync(file, 'x');
    expect(sessionCwd(config({ type: 'page', file, folder: temp() }))).toBe(elsewhere);
    expect(sessionCwd(config({ type: 'page', file, folder: homedir() }))).toBe(elsewhere);
  });
});

describe('prepareBundle', () => {
  const bundle = (root: string, id: string, draftMd = `![](.feedback/sketches/${id}/images/p.png)`) => {
    const dir = join(root, 'project/.feedback/sketches', id);
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'images/p.png'), 'png');
    writeFileSync(join(dir, 'draft.md'), draftMd);
    return dir;
  };

  it('moves the bundle, writes absolute paths in prompt.md, and points other files at siblings', () => {
    const root = temp();
    const dir = bundle(root, 'id1');
    const out = prepareBundle({ id: 'id1', dir, draft: '@.feedback/sketches/id1/draft.md\nDo it.' }, join(root, 'bundles'));
    expect(out).toBe(join(root, 'bundles/id1'));
    expect(readFileSync(join(out, 'prompt.md'), 'utf8')).toBe(`@${out}/draft.md\nDo it.`);
    expect(readFileSync(join(out, 'draft.md'), 'utf8')).toBe('![](images/p.png)');
  });

  it('gives unchanged work the same signature in a different folder', () => {
    const root = temp();
    const first = prepareBundle({ id: 'a', dir: bundle(root, 'a', 'same'), draft: 'x' }, join(root, 'bundles'));
    const second = prepareBundle({ id: 'b', dir: bundle(root, 'b', 'same'), draft: 'y' }, join(root, 'bundles'));
    const third = prepareBundle({ id: 'c', dir: bundle(root, 'c', 'changed'), draft: 'y' }, join(root, 'bundles'));
    expect(bundleSignature(first)).toBe(bundleSignature(second));
    expect(bundleSignature(first)).not.toBe(bundleSignature(third));
  });
});
