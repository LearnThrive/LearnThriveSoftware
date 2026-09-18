import { useState } from 'react';
import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, MAX_POLL_QUESTION_LENGTH, MIN_POLL_OPTIONS, type PollVisibility } from '@learnthrive/shared/protocol';
import { Icon } from './Icon';

interface PollCreatorProps {
  onCreate: (question: string, options: string[], anonymous: boolean, resultsVisible: PollVisibility) => void;
  onCancel: () => void;
}

export function PollCreator({ onCreate, onCancel }: PollCreatorProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [resultsVisible, setResultsVisible] = useState<PollVisibility>('always');

  const setOption = (index: number, value: string) => setOptions(options.map((option, i) => (i === index ? value : option)));
  const addOption = () => { if (options.length < MAX_POLL_OPTIONS) setOptions([...options, '']); };
  const removeOption = (index: number) => { if (options.length > MIN_POLL_OPTIONS) setOptions(options.filter((_, i) => i !== index)); };

  const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && trimmedOptions.length >= MIN_POLL_OPTIONS;

  return (
    <div className="poll-creator">
      <label className="field-label" htmlFor="poll-question">Question</label>
      <input
        id="poll-question" value={question} maxLength={MAX_POLL_QUESTION_LENGTH}
        placeholder="What would you like to ask?" onChange={(event) => setQuestion(event.target.value)}
      />
      <div className="poll-creator-options">
        {options.map((option, index) => (
          <div className="poll-creator-option" key={index}>
            <input
              value={option} maxLength={MAX_POLL_OPTION_LENGTH} placeholder={`Option ${index + 1}`}
              onChange={(event) => setOption(index, event.target.value)}
            />
            {options.length > MIN_POLL_OPTIONS && (
              <button type="button" className="poll-creator-remove-option" onClick={() => removeOption(index)} aria-label={`Remove option ${index + 1}`}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_POLL_OPTIONS && (
          <button type="button" className="poll-creator-add-option" onClick={addOption}><Icon name="plus" size={13} />Add option</button>
        )}
      </div>
      <label className="poll-creator-checkbox">
        <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
        Anonymous voting
      </label>
      <label className="field-label" htmlFor="poll-visibility">Results visible to students</label>
      <select id="poll-visibility" value={resultsVisible} onChange={(event) => setResultsVisible(event.target.value as PollVisibility)}>
        <option value="always">While the poll is open</option>
        <option value="onClose">Only after the poll closes</option>
      </select>
      <div className="poll-creator-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>Cancel</button>
        <button
          type="button" className="button button-primary"
          disabled={!valid}
          onClick={() => onCreate(question.trim(), trimmedOptions, anonymous, resultsVisible)}
        >
          Start poll
        </button>
      </div>
    </div>
  );
}
