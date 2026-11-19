import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type RefObject } from 'react';
import { MAX_CHAT_LENGTH } from '@learnthrive/shared/protocol';
import { CHAT_FILE_ACCEPT, formatFileSize } from '@learnthrive/shared/chatFiles';
import type { DisplayChatMessage } from '../meeting';
import { linkify } from '../linkify';
import { Icon } from './Icon';

interface ChatPanelProps {
  messages: DisplayChatMessage[];
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  isTutor?: boolean;
  onDeleteMessage?: (id: string) => void;
  onClearChat?: () => void;
  canChat?: boolean;
  /** Staff meetings only: share a file (any document, image, slide, spreadsheet, audio, video or zip). Resolves with a message to show if it could not be sent. */
  onSendFile?: (file: File) => Promise<string | null>;
  /** A lesson's saved chat (carries over to later lessons) rather than a meeting's: PNG, JPG and PDF only. */
  lessonChat?: boolean;
  /** Staff meetings only: web addresses in a message are clickable. (A lesson's chat stays plain text.) */
  linkifyMessages?: boolean;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A message's words, with web addresses made clickable when allowed. Drawn as text by React, never as HTML. */
function MessageText({ text, links }: { text: string; links: boolean }) {
  if (!text) return null;
  if (!links) return <p>{text}</p>;
  return (
    <p>
      {linkify(text).map((part, index) => (part.kind === 'link'
        ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="chat-link">{part.text}</a>
        : <span key={index}>{part.text}</span>))}
    </p>
  );
}

export function ChatPanel({
  messages, open, onClose, onSend, triggerRef, isTutor = false, onDeleteMessage, onClearChat, canChat = true, onSendFile, linkifyMessages = false, lessonChat = false,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const share = async (file: File | undefined) => {
    if (!file || !onSendFile || !canChat || sending) return;
    setFileProblem(null);
    setSending(file.name);
    const problem = await onSendFile(file);
    setSending(null);
    if (problem) setFileProblem(problem);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void share(event.dataTransfer.files[0]);
  };

  return (
    <aside
      className={`chat-panel ${dragging ? 'is-dragging' : ''}`} aria-label="Meeting chat"
      onDragOver={onSendFile && canChat ? (event) => { event.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={onSendFile ? () => setDragging(false) : undefined}
      onDrop={onSendFile && canChat ? onDrop : undefined}
    >
      <div className="chat-panel-header">
        <h2>Chat</h2>
        <div className="chat-panel-header-actions">
          {isTutor && messages.length > 0 && onClearChat && (
            <button type="button" className="chat-clear" onClick={onClearChat} aria-label="Clear chat for everyone" title="Clear chat">
              <Icon name="user-x" size={15} />
            </button>
          )}
          <button type="button" className="chat-close" onClick={closeAndReturnFocus} aria-label="Close chat"><Icon name="close" size={18} /></button>
        </div>
      </div>
      <div className="chat-messages" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && <p className="chat-empty">{lessonChat ? 'Messages and files here are saved, and carry over to every future lesson of this class.' : `Messages${onSendFile ? ' and files' : ''} are only visible during this meeting.`}</p>}
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.own ? 'own' : ''}`}>
            <div className="chat-message-meta">
              <span>{message.own ? 'You' : message.name}</span><span>{formatTime(message.timestamp)}</span>
              {isTutor && onDeleteMessage && (
                <button type="button" className="chat-message-delete" onClick={() => onDeleteMessage(message.id)} aria-label="Delete message" title="Delete message">
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
            {message.attachment && (
              message.attachment.image ? (
                <a className="chat-attachment chat-attachment--image" href={message.attachment.url} target="_blank" rel="noopener noreferrer" title={`Open ${message.attachment.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL for a picture held only in this browser: next/image cannot optimise it */}
                  <img src={message.attachment.url} alt={message.attachment.name} />
                  <span>{message.attachment.name} · {formatFileSize(message.attachment.size)}</span>
                </a>
              ) : (
                <a className="chat-attachment chat-attachment--file" href={message.attachment.url} download={message.attachment.name}>
                  <Icon name="file" size={20} />
                  <span className="chat-attachment__text"><strong>{message.attachment.name}</strong><small>{formatFileSize(message.attachment.size)} · Download</small></span>
                  <Icon name="download" size={16} />
                </a>
              )
            )}
            <MessageText text={message.text} links={linkifyMessages} />
          </div>
        ))}
      </div>
      {fileProblem && <p className="chat-file-problem" role="alert">{fileProblem}</p>}
      {sending && <p className="chat-file-sending" role="status">Sending {sending}…</p>}
      <form className="chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Type a message</label>
        {onSendFile && (
          <>
            <input
              ref={fileRef} type="file" className="sr-only" tabIndex={-1} accept={CHAT_FILE_ACCEPT} aria-label="Choose a file to share"
              onChange={(event) => { void share(event.target.files?.[0]); event.target.value = ''; }}
            />
            <button type="button" className="chat-attach" onClick={() => fileRef.current?.click()} disabled={!canChat || Boolean(sending)} aria-label="Share a file" title="Share a file: documents, images, slides, spreadsheets, audio, video, zip (up to 10 MB)">
              <Icon name="attach" size={18} />
            </button>
          </>
        )}
        <input
          id="chat-input" ref={inputRef} value={draft} maxLength={MAX_CHAT_LENGTH} autoComplete="off" disabled={!canChat}
          placeholder={canChat ? 'Type a message…' : 'The tutor has turned off chat for students'} onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="chat-send" disabled={!draft.trim() || !canChat} aria-label="Send message"><Icon name="send" size={17} /></button>
      </form>
      {dragging && <div className="chat-drop-hint" aria-hidden="true">Drop a file to share it</div>}
    </aside>
  );
}
