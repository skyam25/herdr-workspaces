/** A round of questions from `hws ask`, and the person's answers to it. */

export type QuestionKind = 'options' | 'select' | 'text';

export interface Question {
  id: string;
  text: string;
  kind: QuestionKind;
  /** The choices for options and select. */
  options?: string[];
}

/** One question's answer. `other` marks the person's own words on a choice question. */
export interface Answer {
  answer?: string;
  other?: boolean;
}

export type Answers = Record<string, Answer>;

/** `hws ask` writes the round. The host writes the answers beside it. */
export const QUESTIONS_FILE = 'questions.json';
export const ANSWERS_FILE = 'answers.json';

export const NOTHING_ANSWERED = 'Answer a question first, then press Done.';
/** Marks a typed answer to a choice question, so the agent tells it from a listed option. */
export const OWN_WORDS = '(their own words)';
export const NO_ANSWER = '(no answer)';

const KINDS: readonly unknown[] = ['options', 'select', 'text'];
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** The questions a file holds. `hws ask` checked them, so this only drops what cannot show. */
export function readQuestions(value: unknown): Question[] {
  const list = (value as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): Question[] => {
    const { id, text, kind, options } = (raw ?? {}) as Record<string, unknown>;
    if (!isText(id) || !isText(text) || !KINDS.includes(kind)) return [];
    if (kind === 'text') return [{ id, text, kind }];
    const choices = Array.isArray(options) ? options.filter(isText) : [];
    return choices.length ? [{ id, text, kind: kind as QuestionKind, options: choices }] : [];
  });
}

export function readAnswers(value: unknown): Answers {
  const raw = (value as { answers?: unknown } | null)?.answers;
  if (!raw || typeof raw !== 'object') return {};
  const answers: Answers = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const { answer, other } = (entry ?? {}) as Record<string, unknown>;
    answers[id] = { ...(typeof answer === 'string' ? { answer } : {}), ...(other === true ? { other: true } : {}) };
  }
  return answers;
}

const answerOf = (entry: Answer | undefined): string | undefined => (isText(entry?.answer) ? entry.answer.trim() : undefined);

export const isAnswered = (entry: Answer | undefined): boolean => answerOf(entry) !== undefined;

export function answeredCount(questions: readonly Question[], answers: Answers): number {
  return questions.filter((q) => isAnswered(answers[q.id])).length;
}

/** Picks a listed option, or holds the text of a text question. The Other field closes. */
export function choose(answers: Answers, id: string, answer: string): Answers {
  return { ...answers, [id]: { answer } };
}

/** Opens the Other field on a choice question. A listed option drops, and the field takes the next answer. */
export function openOther(answers: Answers, id: string): Answers {
  const held = answers[id];
  return { ...answers, [id]: { ...(held?.other ? held : {}), other: true } };
}

/** Holds the person's own words in an open Other field. */
export function typeOther(answers: Answers, id: string, answer: string): Answers {
  return { ...answers, [id]: { answer, other: true } };
}

export function clearAnswer(answers: Answers, id: string): Answers {
  const { [id]: _, ...rest } = answers;
  return rest;
}

/** A multi-line answer stays under its bullet. */
const indented = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').join('\n  ');

/** What Done delivers, or undefined while nothing is answered. Each question gets a line, answered or not. */
export function answersPrompt(questions: readonly Question[], answers: Answers): string | undefined {
  if (answeredCount(questions, answers) === 0) return undefined;
  const lines = questions.map((q) => {
    const answer = answerOf(answers[q.id]);
    if (answer === undefined) return `- ${q.text}: ${NO_ANSWER}`;
    const ownWords = q.kind !== 'text' && answers[q.id]?.other;
    return `- ${q.text}: ${indented(answer)}${ownWords ? ` ${OWN_WORDS}` : ''}`;
  });
  return ['Answers to your questions:', ...lines].join('\n');
}
