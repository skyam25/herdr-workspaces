// A surface's work as the renderer saves it, in `boards/<name>.excalidraw` with its side files
// and `drafts/<id>.json`, and the bundles and files hws makes from it.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { freeName, linkFor } from './artifacts.js';
import { slug } from './paths.js';

const ATTACHMENT = /\(att:([\w-]+)\)/g;
export const SCENE = 'board.excalidraw';
const BOARD_SIDES = [['.comments.json', 'comments.json'], ['.notes.md', 'notes.md']];

// Copies board `name` from `boards` into a bundle at `dir` with a prompt that links its files.
// `origin` finishes the prompt's first line, as in `saved from Herdr`. Returns the prompt path.
export function copyBoardBundle(boards, name, dir, { title, origin }) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(boards, `${name}.excalidraw`), join(dir, SCENE));
  const sides = BOARD_SIDES.filter(([suffix]) => existsSync(join(boards, `${name}${suffix}`))).map(([suffix, target]) => {
    copyFileSync(join(boards, `${name}${suffix}`), join(dir, target));
    return target;
  });
  const lines = [`Sketch "${title}", ${origin}.`, '', `The drawing is ${linkFor(join(dir, SCENE))}.`];
  if (sides.includes('notes.md')) lines.push(`Its notes are ${linkFor(join(dir, 'notes.md'))}.`);
  if (sides.includes('comments.json')) lines.push(`Its pinned comments are ${linkFor(join(dir, 'comments.json'))}.`);
  const prompt = join(dir, 'prompt.md');
  writeFileSync(prompt, `${lines.join('\n')}\n`);
  return prompt;
}

// The draft's title, else its first line with words, as Agent Brief's list showed it.
export function draftTitle(draft) {
  if (typeof draft.title === 'string' && draft.title.trim()) return draft.title.trim();
  const first = draft.body
    .split('\n')
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\s*(?:#+|[-*+]|\d+[.)]|>)\s*/, '').trim())
    .find(Boolean);
  return (first ?? draft.id).slice(0, 60);
}

// Pasted pictures live in the draft as data URLs, so the Markdown carries them inline.
export function draftMarkdown(draft, title) {
  const body = draft.body.replace(ATTACHMENT, (whole, id) => (draft.attachments?.[id] ? `(${draft.attachments[id]})` : whole)).trimEnd();
  const headed = new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(body.split('\n')[0] ?? '');
  return draft.title && !headed ? `# ${title}\n\n${body}\n` : `${body}\n`;
}

// Writes a draft with a non-empty body as `<slug of title>.md` under `place`. Returns `{ title, file }`, or null.
export function writeDraftFile(draft, place, fallbackId) {
  if (typeof draft?.body !== 'string' || !draft.body.trim()) return null;
  const title = draftTitle({ ...draft, id: draft.id ?? fallbackId });
  const file = freeName(place, `${slug(title)}.md`);
  writeFileSync(file, draftMarkdown(draft, title));
  return { title, file };
}
