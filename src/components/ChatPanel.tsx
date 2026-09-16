import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { MAX_CHAT_LENGTH } from '../../shared/protocol';
import type { DisplayChatMessage } from '../meeting';
import { Icon } from './Icon';

interface ChatPanelProps {
  messages: DisplayChatMessage[];
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel({ messages, open, onClose, onSend, triggerRef }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  // Closing via Escape or the in-panel button should return focus to what opened it, rather
  // than dropping it to <body>; the parent's own toggle button already has focus when it's
  // what triggered the close, so this only needs to cover the panel's own close paths.
  const closeAndReturnFocus = useCallback(() => { onClose(); triggerRef.current?.focus(); }, [onClose, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndReturnFocus(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeAndReturnFocus]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <aside className="chat-panel" aria-label="Meeting chat">
      <div className="chat-panel-header">
        <h2>Chat</h2>
        <button type="button" className="chat-close" onClick={closeAndReturnFocus} aria-label="Close chat"><Icon name="close" size={18} /></button>
      </div>
      <div className="chat-messages" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && <p className="chat-empty">Messages are only visible during this meeting.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.own ? 'own' : ''}`}>
            <div className="chat-message-meta"><span>{message.own ? 'You' : message.name}</span><span>{formatTime(message.timestamp)}</span></div>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Type a message</label>
        <input
          id="chat-input" ref={inputRef} value={draft} maxLength={MAX_CHAT_LENGTH} autoComplete="off"
          placeholder="Type a message…" onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Send message"><Icon name="send" size={17} /></button>
      </form>
    </aside>
  );
}
