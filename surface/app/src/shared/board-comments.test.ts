import { describe, expect, it } from 'vitest';
import { boardCommentsAsk, boardCommentsMarkdown, cleanBoardComments, hasBoardComments, parseBoardCommentsMarkdown } from './board-comments';

const pin = { id: 'p1', elementId: 'start', x: 160.4, y: 150, fx: 0.3, fy: 0.5, type: 'rectangle', label: 'Open the app', frame: 'Login flow', text: 'Say what opens.', createdAt: 1 };

describe('cleanBoardComments', () => {
  it('keeps known fields and drops bad pins', () => {
    const clean = cleanBoardComments({ overall: 'Tighter', pins: [pin, { id: 'bad id!', x: 0, y: 0 }, { ...pin, id: 'p2', fx: 3, extra: 1 }] });
    expect(clean?.pins.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(clean?.pins[1]).toMatchObject({ fx: 1, fy: 0.5 });
    expect(clean?.pins[1]).not.toHaveProperty('extra');
  });

  it('is undefined when nothing is left to send', () => {
    expect(cleanBoardComments({ overall: '  ', pins: [] })).toBeUndefined();
    expect(cleanBoardComments('nope')).toBeUndefined();
    expect(hasBoardComments({ overall: 'x', pins: [] })).toBe(true);
  });
});

describe('boardCommentsMarkdown', () => {
  it('lists the overall note, then each pin with its element id', () => {
    const md = boardCommentsMarkdown('walkthrough', { overall: 'Mostly right.', pins: [pin, { id: 'p2', x: 9, y: 9, text: '', createdAt: 2 }] });
    expect(md).toContain('# Comments on the sketch "walkthrough"');
    expect(md).toContain('## Overall\n\nMostly right.');
    expect(md).toContain('## 1. rectangle “Open the app”\n\nSay what opens.\n\n- Element: `start`\n- In frame: “Login flow”');
    expect(md).toContain('## 2. board\n\n(No words. The pin marks this spot.)\n\n- At: 9,9 on the board');
  });

  it('asks for the changes on the sketch', () => {
    expect(boardCommentsAsk('walkthrough', { overall: '', pins: [pin] })).toBe(
      'Feedback on the sketch "walkthrough" from Herdr, 1 comment pinned to the sketch. Make the changes, on the sketch where they belong, then say what changed.',
    );
  });
});

describe('parseBoardCommentsMarkdown', () => {
  it('reads back the overall note and each pin a Send wrote', () => {
    const silent = { id: 'p2', x: 5, y: 6, text: '', createdAt: 1 };
    const words = { ...pin, text: 'Say what opens.\n\nAnd when.' };
    const md = boardCommentsMarkdown('flow', { overall: 'Tighter.\nMuch tighter.', pins: [words, silent] });
    expect(parseBoardCommentsMarkdown(md)).toEqual({
      overall: 'Tighter.\nMuch tighter.',
      pins: [
        { id: 'p1', elementId: 'start', x: 160, y: 150, type: 'rectangle', label: 'Open the app', frame: 'Login flow', text: 'Say what opens.\n\nAnd when.', createdAt: 0 },
        { id: 'p2', x: 5, y: 6, text: '', createdAt: 0 },
      ],
    });
  });

  it('is undefined for a file with no comments', () => {
    expect(parseBoardCommentsMarkdown('# Comments on the board "flow"\n\nIntro.\n')).toBeUndefined();
  });
});
