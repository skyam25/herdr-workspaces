import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, tempDataDir, type Launched } from './helpers';

let ctx: Launched | undefined;

test.afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

test('a note surface shows its file, and shows it again after the page reloads', async () => {
  const dataDir = tempDataDir();
  const project = mkdtempSync(join(tmpdir(), 'project-'));
  mkdirSync(join(project, 'docs'));
  writeFileSync(join(project, 'docs/plan.md'), '# Plan\n\nShip the footer on Friday.\n');
  ctx = await launch(dataDir, {
    HWS_SURFACE_ID: 'sn1',
    HWS_SURFACE_TYPE: 'note',
    HWS_SURFACE_TITLE: 'Plan',
    HWS_SURFACE_FILE: 'docs/plan.md',
    HWS_TERMINAL: 't1',
    HWS_FOLDER: project,
    HWS_SESSION_FOLDER: project,
  });
  const { page } = ctx;
  const body = page.getByTestId('draft-body');
  await expect(body).toContainText('Ship the footer');

  await page.reload();
  await page.waitForFunction(() => !!window.__board?.api, undefined, { timeout: 30_000 });
  await expect(body).toContainText('Ship the footer');
});
