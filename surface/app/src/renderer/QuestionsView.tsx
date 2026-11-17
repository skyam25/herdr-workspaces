import type { Answers, Question } from '../shared/questions';
import { answeredCount, choose, clearAnswer, isAnswered, openOther, typeOther } from '../shared/questions';

const OTHER = '__other__';

/** A round from `hws ask`: each question with its answer control. Done sits in the composer below. */
export function QuestionsView(props: { questions: Question[]; answers: Answers; onChange: (answers: Answers) => void }) {
  const { questions, answers } = props;
  const answered = answeredCount(questions, answers);
  return (
    <div className="questions" data-testid="questions">
      <div className="questions-column">
        <p className="questions-lead muted" data-testid="questions-count">
          {answered === 0 ? `${questions.length} ${questions.length === 1 ? 'question' : 'questions'} from the agent` : `${answered} of ${questions.length} answered`}
          {' · '}Done sends the answers back.
        </p>
        {questions.length === 0 && <p className="muted">This round has no questions to show.</p>}
        <ol className="question-list">
          {questions.map((q, at) => (
            <QuestionRow key={q.id} question={q} number={at + 1} answers={answers} onChange={props.onChange} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function QuestionRow(props: { question: Question; number: number; answers: Answers; onChange: (answers: Answers) => void }) {
  const { question: q, answers, onChange } = props;
  const entry = answers[q.id];
  const labelId = `question-${q.id}-text`;
  return (
    <li className={isAnswered(entry) ? 'question answered' : 'question'} data-testid={`question-${q.id}`}>
      <div className="question-head">
        <span className="question-number" aria-hidden="true">
          {props.number}
        </span>
        <p className="question-text" id={labelId}>
          {q.text}
        </p>
        {(isAnswered(entry) || entry?.other) && (
          <button className="ghost small question-clear" onClick={() => onChange(clearAnswer(answers, q.id))} data-testid={`question-${q.id}-clear`}>
            Clear
          </button>
        )}
      </div>
      <div className="question-control">{control(q, answers, onChange, labelId)}</div>
    </li>
  );
}

function control(q: Question, answers: Answers, onChange: (answers: Answers) => void, labelId: string) {
  const entry = answers[q.id];
  if (q.kind === 'text') {
    return (
      <textarea
        className="question-field"
        aria-labelledby={labelId}
        placeholder="Your answer"
        rows={1}
        value={entry?.answer ?? ''}
        onChange={(e) => onChange(choose(answers, q.id, e.target.value))}
        data-testid={`question-${q.id}-answer`}
      />
    );
  }
  const other = entry?.other && (
    <input
      className="question-field"
      aria-label={`Your own answer to ${q.text}`}
      placeholder="Your own answer"
      autoFocus
      value={entry.answer ?? ''}
      onChange={(e) => onChange(typeOther(answers, q.id, e.target.value))}
      data-testid={`question-${q.id}-other`}
    />
  );
  if (q.kind === 'select') {
    const value = entry?.other ? OTHER : (entry?.answer ?? '');
    return (
      <>
        <select
          className="question-select"
          aria-labelledby={labelId}
          value={value}
          onChange={(e) => {
            const picked = e.target.value;
            if (picked === OTHER) onChange(openOther(answers, q.id));
            else if (picked) onChange(choose(answers, q.id, picked));
          }}
          data-testid={`question-${q.id}-select`}
        >
          {!value && <option value="">Pick one</option>}
          {q.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
        {other}
      </>
    );
  }
  return (
    <>
      <div className="question-choices" role="group" aria-labelledby={labelId}>
        {q.options?.map((option, at) => {
          const picked = !entry?.other && entry?.answer === option;
          return (
            <button
              key={option}
              className={picked ? 'question-choice picked' : 'question-choice'}
              aria-pressed={picked}
              onClick={() => onChange(choose(answers, q.id, option))}
              data-testid={`question-${q.id}-option-${at}`}
            >
              {option}
            </button>
          );
        })}
        <button
          className={entry?.other ? 'question-choice picked' : 'question-choice'}
          aria-pressed={!!entry?.other}
          onClick={() => onChange(openOther(answers, q.id))}
          data-testid={`question-${q.id}-other-toggle`}
        >
          Other…
        </button>
      </div>
      {other}
    </>
  );
}
