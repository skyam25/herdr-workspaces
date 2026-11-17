import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.js';

export const MAX_QUESTIONS = 8;
export const MIN_OPTIONS = 2;

// Buttons fit four short choices. A dropdown holds six.
export const MAX_OPTIONS = { options: 4, select: 6 };
const KINDS = ['options', 'select', 'text'];

// `hws ask` writes the round. The host writes the person's answers beside it.
export const QUESTIONS_FILE = 'questions.json';
export const ANSWERS_FILE = 'answers.json';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

function parseQuestion(raw, at) {
  const field = (name) => `questions[${at}].${name}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new UsageError(`questions[${at}] must be an object`);
  const { id, text, kind, options } = raw;
  if (!isText(id)) throw new UsageError(`${field('id')} must be a non-empty string`);
  if (!isText(text)) throw new UsageError(`${field('text')} must be a non-empty string`);
  if (!KINDS.includes(kind)) throw new UsageError(`${field('kind')} must be options, select or text`);
  const question = { id: id.trim(), text: text.trim(), kind };
  if (kind === 'text') {
    if (options !== undefined) throw new UsageError(`${field('options')} is only for options and select questions`);
    return question;
  }
  const most = MAX_OPTIONS[kind];
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > most) {
    throw new UsageError(`${field('options')} must list ${MIN_OPTIONS} to ${most} choices for kind ${kind}`);
  }
  if (!options.every(isText)) throw new UsageError(`${field('options')} must hold non-empty strings`);
  const choices = options.map((option) => option.trim());
  if (new Set(choices).size !== choices.length) throw new UsageError(`${field('options')} must not repeat a choice`);
  return { ...question, options: choices };
}

// Takes `[...]` or `{ questions: [...] }`. A bad shape exits 2 with the field it names.
export function parseQuestions(value) {
  const list = Array.isArray(value) ? value : value?.questions;
  if (!Array.isArray(list)) throw new UsageError('questions must be an array, or an object with a questions array');
  if (list.length < 1 || list.length > MAX_QUESTIONS) throw new UsageError(`questions must hold 1 to ${MAX_QUESTIONS} questions`);
  const questions = list.map(parseQuestion);
  const seen = new Set();
  questions.forEach(({ id }, at) => {
    if (seen.has(id)) throw new UsageError(`questions[${at}].id repeats ${JSON.stringify(id)}`);
    seen.add(id);
  });
  return questions;
}

export function parseQuestionsText(text, source) {
  if (!text.trim()) throw new UsageError(`no questions in ${source}`);
  try {
    return parseQuestions(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new UsageError(`${source} is not JSON: ${error.message}`);
    throw error;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// The round a surface's data folder holds, with its answers. Missing files read as empty.
export function readRound(dataDir) {
  const questions = readJson(join(dataDir, QUESTIONS_FILE))?.questions;
  const answers = readJson(join(dataDir, ANSWERS_FILE))?.answers;
  return {
    questions: Array.isArray(questions) ? questions : [],
    answers: answers && typeof answers === 'object' ? answers : {},
  };
}

export const isAnswered = (entry) => typeof entry?.answer === 'string' && entry.answer.trim() !== '';

// A new round keeps the answered questions it does not ask again, ahead of the new ones.
// The round holds at most MAX_QUESTIONS, so the oldest answered ones go first. `dropped` counts them.
export function mergeRound(held, asked) {
  const askedIds = new Set(asked.map((question) => question.id));
  const answered = held.questions.filter((question) => isAnswered(held.answers[question.id]) && !askedIds.has(question.id));
  const room = Math.max(0, MAX_QUESTIONS - asked.length);
  const kept = room === 0 ? [] : answered.slice(-room);
  const answers = Object.fromEntries(kept.map((question) => [question.id, held.answers[question.id]]));
  return { questions: [...kept, ...asked], answers, dropped: answered.length - kept.length };
}
