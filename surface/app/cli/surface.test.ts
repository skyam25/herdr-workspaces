import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { cliFor } from './command';
import { formatFeedback, formatWorkspace } from './feedback';
import { COMMAND_NAMES } from './help';
import { SURFACE_NOT_RUNNING_MESSAGE } from './main';
import { formatOutline, formatOutlineProject } from './outline';
import { useFakeApp } from './testkit';

const { app, run } = useFakeApp();

const surface = cliFor({ HWS_SURFACE_CLI_CWD: '/work' });
const onSurface = (argv: string[], stdin = '') => run(argv, stdin, { HWS_SURFACE_CLI_CWD: app.dir });

describe('command lines', () => {
  it('name agent-brief outside hws surface cli', () => {
    expect(cliFor({}).line('draw --board b')).toBe('agent-brief draw --board b');
  });

  it('name hws surface cli with the type each verb needs', () => {
    expect(surface.line('draw --board b')).toBe('hws surface cli --type board -- draw --board b');
    expect(surface.line('read')).toBe('hws surface cli --type board -- read');
    expect(surface.line('feedback round')).toBe('hws surface cli --type page -- feedback round');
    expect(surface.line('behavior show p.html')).toBe('hws surface cli --type page -- behavior show p.html');
    expect(surface.line('open --board b')).toBe('hws surface cli -- open --board b');
  });

  it('reach the hints the formatters print', () => {
    expect(formatFeedback({ path: 'p.html', version: 'missing' } as never, surface)).toContain('"hws surface cli --type page -- feedback round"');
    expect(formatOutline({ path: 'x.outline.md', version: 'missing' } as never, surface)).toContain('"hws surface cli --type page -- outline new"');
    expect(formatOutlineProject({ files: [] } as never, surface)).toContain('"hws surface cli --type page -- outline new"');
    const ws = formatWorkspace({ board: 'fb-checkout-1', created: true, framed: true, round: 1 } as never, surface);
    expect(ws).toContain('Draw with: hws surface cli --type board -- draw --board fb-checkout-1');
  });
});

describe('under hws surface cli', () => {
  it('prints help that names hws surface cli and never agent-brief', async () => {
    const top = await onSurface(['help']);
    expect(top.stdout).toContain('Usage: hws surface cli');
    expect(top.stdout).toContain('| hws surface cli --type board -- draw');
    for (const cmd of COMMAND_NAMES) {
      const r = await onSurface([cmd, '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hws surface cli ');
      expect(r.stdout).not.toMatch(/agent-brief|Agent Brief/);
    }
    expect((await onSurface(['read', '--help'])).stdout).toContain('hws surface cli --type board -- read [--board <name>]');
    expect((await onSurface(['outline', '--help'])).stdout).toContain('hws surface cli --type page -- outline <verb>');
    expect(app.seen).toHaveLength(0);
  });

  it('refuses verbs a surface cannot serve and names what to use instead', async () => {
    const cases: [string[], string][] = [
      [['show', 'a.png'], 'hws surface cli --type board -- snap FILE'],
      [['output', 'Brief', '--path', 'a.md'], 'hws output add'],
      [['handoff', '--prompt', 'x'], 'hws phone send FILE'],
      [['ipad'], 'hws phone status'],
      [['initiative', 'list'], 'hws current --line'],
      [['note', '--text', 'hi'], 'hws surface open --type note --file F'],
      [['open', '--note', 'd1'], 'hws surface open --type note --file F'],
      [['open', '--initiative', 'Pricing'], 'hws current --line'],
    ];
    for (const [argv, instead] of cases) {
      const r = await onSurface(argv);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain(instead);
    }
    expect(app.seen).toHaveLength(0);
  });

  it('names the surface in its status', async () => {
    app.handler = () => ({ json: { ok: true, version: 1, pid: 42, panelVisible: true, currentBoard: 'main' } });
    expect((await onSurface(['status'])).stdout).toMatch(/^Surface running · pid 42/);
  });

  it('names hws surface cli for an unknown command', async () => {
    const r = await onSurface(['wat']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('"hws surface cli -- help"');
  });

  it('says the surface is not running', async () => {
    await new Promise((ok) => app.server.close(ok));
    for (const argv of [['status'], ['read'], ['open']]) {
      const r = await onSurface(argv);
      expect(r.code).toBe(3);
      expect(r.stderr).toBe(`${SURFACE_NOT_RUNNING_MESSAGE}\n`);
    }
    app.server = http.createServer();
    await new Promise<void>((ok) => app.server.listen(app.socket, ok));
  });
});
