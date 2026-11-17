import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { RESULTS, ROOT, launch, tempDataDir, type Launched } from './helpers';

const FAKE_HWS = resolve(ROOT, '..', 'test', 'fake-hws');

const ROUND = {
  questions: [
    { id: 'audience', text: 'Who reads the brief?', kind: 'options', options: ['Engineers', 'Managers', 'Both'] },
    { id: 'format', text: 'Which format should it take?', kind: 'select', options: ['Memo', 'Deck', 'One page'] },
    { id: 'tone', text: 'What tone fits?', kind: 'options', options: ['Plain', 'Formal'] },
    { id: 'deadline', text: 'When is it due?', kind: 'text' },
  ],
};

let ctx: Launched | undefined;

test.afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

test('a questions surface holds answers as they change and Done hands hws one prompt', async () => {
  const dataDir = tempDataDir();
  const fake = join(dataDir, 'fake');
  mkdirSync(fake);
  writeFileSync(join(dataDir, 'questions.json'), JSON.stringify(ROUND));
  ctx = await launch(dataDir, {
    HWS_SURFACE_ID: 'sq1',
    HWS_SURFACE_TYPE: 'questions',
    HWS_SURFACE_TITLE: 'Brief',
    HWS_TERMINAL: 't1',
    HWS_WORKSPACE_ID: 'w1',
    HWS_WORKSPACE_NAME: 'demo',
    HWS_FOLDER: dataDir,
    HWS_BIN: FAKE_HWS,
    FAKE_HWS_DIR: fake,
  });
  const { page } = ctx;
  await page.setViewportSize({ width: 900, height: 760 });
  await expect(page.getByTestId('questions')).toBeVisible();
  await expect(page.getByTestId('questions-count')).toContainText('4 questions from the agent');

  await page.getByTestId('question-audience-option-0').click();
  await page.getByTestId('question-format-select').selectOption('Deck');
  await page.getByTestId('question-tone-other-toggle').click();
  await page.getByTestId('question-tone-other').fill('Warm but brief');
  await expect(page.getByTestId('questions-count')).toContainText('3 of 4 answered');
  await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'answers.json'), 'utf8')).answers.tone).toEqual({ answer: 'Warm but brief', other: true });

  for (const theme of ['light', 'dark']) {
    await page.evaluate((name) => (document.documentElement.dataset.theme = name), theme);
    await page.screenshot({ path: join(RESULTS, `questions-${theme}.png`) });
  }

  await page.getByTestId('surface-done').click();
  const prompt = join(fake, 'artifacts', 'a0', 'prompt.md');
  await expect.poll(() => existsSync(prompt), { timeout: 15_000 }).toBe(true);
  expect(readFileSync(prompt, 'utf8')).toBe(
    [
      'Answers to your questions:',
      '- Who reads the brief?: Engineers',
      '- Which format should it take?: Deck',
      '- What tone fits?: Warm but brief (their own words)',
      '- When is it due?: (no answer)',
    ].join('\n'),
  );
  expect(readFileSync(join(fake, 'hws.log'), 'utf8')).toMatch(/^surface done --id sq1 --bundle /m);
});

test('Done with nothing answered says so and sends nothing', async () => {
  const dataDir = tempDataDir();
  const fake = join(dataDir, 'fake');
  mkdirSync(fake);
  writeFileSync(join(dataDir, 'questions.json'), JSON.stringify(ROUND));
  ctx = await launch(dataDir, { HWS_SURFACE_ID: 'sq2', HWS_SURFACE_TYPE: 'questions', HWS_TERMINAL: 't1', HWS_FOLDER: dataDir, HWS_BIN: FAKE_HWS, FAKE_HWS_DIR: fake });
  const { page } = ctx;
  await expect(page.getByTestId('questions')).toBeVisible();

  await page.getByTestId('surface-done').click();

  await expect(page.getByText('Answer a question first, then press Done.')).toBeVisible();
  expect(existsSync(join(fake, 'artifacts'))).toBe(false);
});
