// Finds existing work a kept workspace does not track yet: output files under its
// home, files its documents link to, and web documents those documents name.

import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { allPlaces, homeOf, isKept } from './places.js';

const MAX_DEPTH = 4;
const MAX_ENTRIES = 5000;
const MAX_TEXTS = 80;
const TEXT_BYTES = 256 * 1024;
const MAX_SHOWN = 40;

const OUTPUT = /\.(html?|pptx|potx|key|pdf|docx|xlsx|excalidraw)$/i;
const READS_LINKS = /\.(md|markdown|html?)$/i;
const SIDE_FILE = /\.(feedback|outline)\.md$/i;
const FIRST = /^(readme|current)\b/i;
const WEB = /https:\/\/(?:claude\.ai\/(?:code\/)?artifact\/[\w-]+|docs\.google\.com\/(?:document|presentation|spreadsheets)\/d\/[\w-]+|[\w-]+\.sharepoint\.com\/[^\s)"'<>]+|(?:www\.)?figma\.com\/[^\s)"'<>]+)/g;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const HTML_LINK = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([^<]*)/gi;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Places the workspace already uses for records and drafts hold nothing to adopt.
function skippedPlaces(manifest) {
  const { history, scratch, decisions, meetings, notes } = allPlaces(manifest);
  return new Set([history, scratch, decisions, meetings, notes].filter(Boolean));
}

function walk(root, skipped) {
  const files = [];
  let entries = 0;
  const visit = (folder, depth) => {
    let names;
    try {
      names = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (++entries > MAX_ENTRIES || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(folder, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory() && depth < MAX_DEPTH && !skipped.has(path)) visit(path, depth + 1);
    }
  };
  visit(root, 0);
  return files;
}

function head(path) {
  const buffer = Buffer.alloc(TEXT_BYTES);
  const fd = openSync(path, 'r');
  try {
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, TEXT_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

function linksIn(text) {
  const named = [
    ...[...text.matchAll(MARKDOWN_LINK)].map((m) => ({ title: m[1], href: m[2] })),
    ...[...text.matchAll(HTML_LINK)].map((m) => ({ href: m[1], title: m[2].trim() })),
  ];
  const seen = new Set(named.map((link) => link.href));
  const bare = [...text.matchAll(WEB)].map((m) => m[0]).filter((href) => !seen.has(href));
  return [...named, ...bare.map((href) => ({ href, title: null }))];
}

const realOrSame = (path) => (existsSync(path) ? realpathSync(path) : path);

function decoded(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

function localTarget(href, doc) {
  const path = decoded(href.replace(/[?#].*$/, ''));
  if (!path || HAS_SCHEME.test(href)) return null;
  const target = resolve(dirname(doc), path);
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

const isWebDocument = (href) => [...href.matchAll(WEB)].some((m) => m.index === 0 && m[0] === href);

// Reads the README and the note first, then the newest documents, so the cap drops the least useful.
function documentsToRead(files) {
  const newest = (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs;
  const docs = files.filter((path) => READS_LINKS.test(path) && !SIDE_FILE.test(path)).sort(newest);
  return [...docs.filter((path) => FIRST.test(basename(path))), ...docs.filter((path) => !FIRST.test(basename(path)))].slice(0, MAX_TEXTS);
}

function linkedFrom(docs, home) {
  const files = new Map();
  const web = new Map();
  for (const doc of docs) {
    let text;
    try {
      text = head(doc);
    } catch {
      continue;
    }
    for (const { href, title } of linksIn(text)) {
      const foundIn = relative(home, doc);
      if (isWebDocument(href)) {
        if (!web.has(href)) web.set(href, { kind: 'link', url: href, title: title || null, foundIn });
        continue;
      }
      const target = localTarget(href, doc);
      if (target && target !== doc && !SIDE_FILE.test(target) && (OUTPUT.test(target) || READS_LINKS.test(target)) && !files.has(target)) files.set(target, { title: title || null, foundIn });
    }
  }
  return { files, web };
}

function trackedOf(manifest) {
  return manifest.artifacts.filter((item) => !item.role).map(({ id, type, title, path, status }) => ({ id, type, title: title ?? null, path, status: status ?? 'current' }));
}

function candidatesOf(manifest, tracked) {
  const home = homeOf(manifest);
  const taken = new Set(tracked.map((item) => realOrSame(item.path ?? '')));
  const note = allPlaces(manifest).current;
  const files = walk(home, skippedPlaces(manifest));
  const { files: linked, web } = linkedFrom(documentsToRead(files), home);
  const owned = files.filter((path) => OUTPUT.test(path)).map((path) => ({ path, title: linked.get(path)?.title ?? null, foundIn: linked.get(path)?.foundIn ?? null, origin: 'folder' }));
  const reached = [...linked].filter(([path]) => !owned.some((item) => item.path === path)).map(([path, { title, foundIn }]) => ({ path, title, foundIn, origin: 'linked' }));
  const local = [...owned, ...reached]
    .filter(({ path }) => path !== note && !taken.has(realOrSame(path)))
    .map((item) => ({ kind: 'file', ...item, modifiedAt: statSync(item.path).mtimeMs }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  return [...[...web.values()].filter(({ url }) => !taken.has(url)), ...local];
}

// Candidates are only suggestions. The person picks which become artifacts.
export function scanWorkspace(manifest) {
  const tracked = trackedOf(manifest);
  if (!isKept(manifest)) return { tracked, candidates: [], more: 0 };
  const found = candidatesOf(manifest, tracked);
  return { tracked, candidates: found.slice(0, MAX_SHOWN), more: Math.max(0, found.length - MAX_SHOWN) };
}
