import { describe, expect, it } from 'vitest';
import { answeredCount, answersPrompt, choose, clearAnswer, openOther, readAnswers, readQuestions, typeOther, type Question } from './questions';

const ROUND: Question[] = [
  { id: 'audience', text: 'Who reads it?', kind: 'options', options: ['Engineers', 'Managers'] },
  { id: 'format', text: 'Which format?', kind: 'select', options: ['Memo', 'Deck', 'Page'] },
  { id: 'deadline', text: 'When is it due?', kind: 'text' },
];

describe('answersPrompt', () => {
  it('lists every question, marks the unanswered and the person’s own words', () => {
    let answers = choose({}, 'audience', 'Engineers');
    answers = typeOther(openOther(answers, 'format'), 'format', '  A one-pager ');
    expect(answersPrompt(ROUND, answers)).toBe(
      ['Answers to your questions:', '- Who reads it?: Engineers', '- Which format?: A one-pager (their own words)', '- When is it due?: (no answer)'].join('\n'),
    );
  });

  it('keeps a multi-line answer under its bullet, with no own-words mark on a text question', () => {
    const answers = choose({}, 'deadline', 'Friday\r\nor Monday at the latest');
    expect(answersPrompt(ROUND.slice(2), answers)).toBe('Answers to your questions:\n- When is it due?: Friday\n  or Monday at the latest');
  });

  it('gives nothing while every answer is blank', () => {
    expect(answersPrompt(ROUND, {})).toBeUndefined();
    expect(answersPrompt(ROUND, { deadline: { answer: '   ' }, format: { other: true } })).toBeUndefined();
  });
});

describe('answer changes', () => {
  it('opens Other in place of a listed option and closes it on the next pick', () => {
    const picked = choose({}, 'audience', 'Managers');
    const other = openOther(picked, 'audience');
    expect(other.audience).toEqual({ other: true });
    expect(answeredCount(ROUND, other)).toBe(0);
    expect(choose(other, 'audience', 'Engineers').audience).toEqual({ answer: 'Engineers' });
  });

  it('keeps typed words when Other is pressed again, and clears one question only', () => {
    const typed = typeOther(openOther({}, 'format'), 'format', 'Wiki');
    expect(openOther(typed, 'format').format).toEqual({ answer: 'Wiki', other: true });
    const both = choose(typed, 'deadline', 'Friday');
    expect(answeredCount(ROUND, both)).toBe(2);
    expect(clearAnswer(both, 'format')).toEqual({ deadline: { answer: 'Friday' } });
  });
});

describe('reading the round', () => {
  it('drops what cannot show and keeps the rest in order', () => {
    const file = { questions: [ROUND[0], { id: 'x', text: 'No kind' }, { id: 'y', text: 'No choices', kind: 'select', options: [] }, ROUND[2]] };
    expect(readQuestions(file)).toEqual([ROUND[0], ROUND[2]]);
    expect(readQuestions(undefined)).toEqual([]);
  });

  it('reads answers and ignores stray fields', () => {
    expect(readAnswers({ answers: { a: { answer: 'Yes', other: true, at: 3 }, b: { answer: 4 }, c: null } })).toEqual({ a: { answer: 'Yes', other: true }, b: {}, c: {} });
    expect(readAnswers({})).toEqual({});
  });
});
