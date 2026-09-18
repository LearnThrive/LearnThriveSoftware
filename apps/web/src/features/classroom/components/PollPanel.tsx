import type { PollState } from '@learnthrive/shared/protocol';
import { Icon } from './Icon';

interface PollPanelProps {
  poll: PollState;
  isTutor: boolean;
  onVote: (optionId: string) => void;
  onClose: () => void;
  onClear: () => void;
}

export function PollPanel({ poll, isTutor, onVote, onClose, onClear }: PollPanelProps) {
  const showResults = poll.results !== null;
  const maxVotes = showResults ? Math.max(1, ...poll.options.map((option) => poll.results![option.id] ?? 0)) : 1;

  return (
    <section className="poll-panel" aria-label="Class poll">
      <div className="poll-panel-header">
        <span className="poll-panel-label"><Icon name="poll" size={14} />{poll.open ? 'Poll' : 'Poll closed'}</span>
        {isTutor && (
          <span className="poll-panel-actions">
            {poll.open && <button type="button" className="inline-action" onClick={onClose}>Close poll</button>}
            <button type="button" className="inline-action" onClick={onClear}>Clear</button>
          </span>
        )}
      </div>
      <p className="poll-panel-question">{poll.question}</p>
      <div className="poll-panel-options">
        {poll.options.map((option) => {
          const count = showResults ? poll.results![option.id] ?? 0 : null;
          const pct = showResults && poll.totalVotes > 0 ? Math.round(((count ?? 0) / maxVotes) * 100) : 0;
          const mine = poll.myVote === option.id;
          return poll.open ? (
            <button
              key={option.id} type="button" className={`poll-panel-option ${mine ? 'is-selected' : ''}`}
              onClick={() => onVote(option.id)} aria-pressed={mine}
            >
              {showResults && <span className="poll-panel-option-bar" style={{ width: `${pct}%` }} />}
              <span className="poll-panel-option-label">{mine && <Icon name="check" size={13} />}{option.text}</span>
              {showResults && <span className="poll-panel-option-count">{count}</span>}
            </button>
          ) : (
            <div key={option.id} className={`poll-panel-option is-static ${mine ? 'is-selected' : ''}`}>
              {showResults && <span className="poll-panel-option-bar" style={{ width: `${pct}%` }} />}
              <span className="poll-panel-option-label">{mine && <Icon name="check" size={13} />}{option.text}</span>
              {showResults && <span className="poll-panel-option-count">{count}</span>}
            </div>
          );
        })}
      </div>
      {!showResults && <p className="poll-panel-hint">Results will be shown once the poll closes.</p>}
      {showResults && <p className="poll-panel-hint">{poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}</p>}
      {isTutor && poll.voters && poll.voters.length > 0 && (
        <p className="poll-panel-hint">Voted: {poll.voters.map((voter) => voter.name).join(', ')}</p>
      )}
    </section>
  );
}
