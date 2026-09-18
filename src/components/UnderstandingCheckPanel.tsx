import type { UnderstandingCheckState, UnderstandingStatus } from '../../shared/protocol';
import { Icon } from './Icon';

interface UnderstandingCheckPanelProps {
  check: UnderstandingCheckState;
  isTutor: boolean;
  onRespond: (status: UnderstandingStatus) => void;
  onEnd: () => void;
}

const STATUS_LABEL: Record<UnderstandingStatus, string> = { understood: 'Got it', confused: 'A bit confused', lost: 'Lost' };

export function UnderstandingCheckPanel({ check, isTutor, onRespond, onEnd }: UnderstandingCheckPanelProps) {
  return (
    <section className="understanding-panel" aria-label="Understanding check">
      <div className="understanding-panel-header">
        <span className="poll-panel-label"><Icon name="help-circle" size={14} />How's everyone doing?</span>
        {isTutor && <button type="button" className="inline-action" onClick={onEnd}>End check</button>}
      </div>
      {isTutor ? (
        <>
          {check.summary && (
            <div className="understanding-summary">
              <span className="understanding-summary-item understanding-understood">{check.summary.understood} got it</span>
              <span className="understanding-summary-item understanding-confused">{check.summary.confused} confused</span>
              <span className="understanding-summary-item understanding-lost">{check.summary.lost} lost</span>
            </div>
          )}
          <ul className="understanding-responses">
            {check.responses?.map((response) => (
              <li key={response.id}>
                <span>{response.name}</span>
                <span className={response.status ? `understanding-${response.status}` : 'understanding-pending'}>
                  {response.status ? STATUS_LABEL[response.status] : 'No response yet'}
                </span>
              </li>
            ))}
            {check.responses?.length === 0 && <li className="participant-row-empty">No students yet.</li>}
          </ul>
        </>
      ) : (
        <div className="understanding-buttons">
          {(['understood', 'confused', 'lost'] as const).map((status) => (
            <button
              key={status} type="button" className={`understanding-button understanding-${status} ${check.myStatus === status ? 'is-selected' : ''}`}
              onClick={() => onRespond(status)} aria-pressed={check.myStatus === status}
            >
              {check.myStatus === status && <Icon name="check" size={13} />}{STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
