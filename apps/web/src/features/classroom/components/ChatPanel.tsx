import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type RefObject } from 'react';
import { CHAT_REACTION_EMOJIS, MAX_CHAT_LENGTH, type StaffTitle } from '@learnthrive/shared/protocol';
import { CHAT_FILE_ACCEPT, formatFileSize } from '@learnthrive/shared/chatFiles';
import type { DisplayChatMessage } from '../meeting';
import { linkify } from '../linkify';
import { Icon } from './Icon';

/** Who someone in the room is, for the title beside a message and the names under a reaction. */
export interface ChatPerson { name: string; title?: StaffTitle }

interface ChatPanelProps {
  messages: DisplayChatMessage[];
  open: boolean;
  onClose: () => void;
  onSend: (text: string, replyTo?: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Staff meetings: whether THIS person may delete this message (the writer, the host, an administrator). Absent = no Delete button. */
  canDelete?: (message: DisplayChatMessage) => boolean;
  onDeleteMessage?: (id: string) => void;
  /** Staff meetings: the host or an administrator may clear the whole chat. */
  canClear?: boolean;
  onClearChat?: () => void;
  /** Staff meetings: the writer changes their own message's words (the old words are gone for everyone). Absent = no Edit button. */
  onEdit?: (id: string, text: string) => void;
  /** Staff meetings: react to a message with an emoji (a second tap on the same emoji takes it back). Absent = no reactions and no Reply. */
  onReact?: (id: string, emoji: string) => void;
  /** This person's id in the room, to know which reactions are theirs. */
  selfId?: string;
  /** Everyone in the room by id. */
  people?: Record<string, ChatPerson>;
  canChat?: boolean;
  /** Staff meetings only: share a file (any document, image, slide, spreadsheet, audio, video or zip). Resolves with a message to show if it could not be sent. */
  onSendFile?: (file: File) => Promise<string | null>;
  /** A lesson's saved chat (carries over to later lessons) rather than a meeting's: PNG, JPG and PDF only. */
  lessonChat?: boolean;
  /** Staff meetings only: web addresses in a message are clickable. (A lesson's chat stays plain text.) */
  linkifyMessages?: boolean;
}

/** Messages from the same person this close together read as one run, as in Discord: the name and avatar are shown once. */
const RUN_MS = 5 * 60_000;
const QUICK_REACTIONS = CHAT_REACTION_EMOJIS.slice(0, 3);

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A steady colour per person, so the same sender looks the same all the way down the chat. */
function hueOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
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
  messages, open, onClose, onSend, triggerRef, canDelete, onDeleteMessage, canClear = false, onClearChat, onReact, onEdit, selfId, people = {},
  canChat = true, onSendFile, linkifyMessages = false, lessonChat = false,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The message you have clicked: its actions stay open (on a phone this is how you reach them). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // The reply and the edit are held by message id and looked up in `messages` each time, so an edit by someone else shows the new words here, never the old.
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const replyingTo = messages.find((message) => message.id === replyingId) ?? null;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stuckToEnd = useRef(true);

  const interactive = Boolean(onReact);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // Follow new messages while you are at the bottom; leave the scroll alone while you read further up (a reaction landing must not yank it down).
  useEffect(() => {
    const list = listRef.current;
    if (open && list && stuckToEnd.current) list.scrollTop = list.scrollHeight;
  }, [lastId, messages.length, open]);

  // A message that was deleted takes its selection, its open menus and any reply to it with it.
  useEffect(() => {
    const present = new Set(messages.map((message) => message.id));
    if (selectedId && !present.has(selectedId)) setSelectedId(null);
    if (pickerFor && !present.has(pickerFor)) setPickerFor(null);
    if (confirmDeleteId && !present.has(confirmDeleteId)) setConfirmDeleteId(null);
    if (replyingId && !present.has(replyingId)) setReplyingId(null);
    if (editingId && !present.has(editingId)) setEditingId(null);
  }, [messages, selectedId, pickerFor, confirmDeleteId, replyingId, editingId]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  // Closing via Escape or the in-panel button should return focus to what opened it, rather
  // than dropping it to <body>; the parent's own toggle button already has focus when it's
  // what triggered the close, so this only needs to cover the panel's own close paths.
  const closeAndReturnFocus = useCallback(() => { onClose(); triggerRef.current?.focus(); }, [onClose, triggerRef]);

  // Escape peels back one thing at a time: a menu, a delete question, a reply, a selection, and only then the chat.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pickerFor) setPickerFor(null);
      else if (confirmDeleteId) setConfirmDeleteId(null);
      else if (editingId) setEditingId(null);
      else if (replyingId) { setReplyingId(null); inputRef.current?.focus(); }
      else if (selectedId) setSelectedId(null);
      else closeAndReturnFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeAndReturnFocus, pickerFor, confirmDeleteId, replyingId, editingId, selectedId]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft, replyingTo?.id);
    setDraft('');
    setReplyingId(null);
    stuckToEnd.current = true;
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

  const onListScroll = () => {
    const list = listRef.current;
    if (list) stuckToEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  };

  const select = (event: MouseEvent, id: string) => {
    // Clicking a link, a reaction or an action is that thing's own business, not a selection.
    if ((event.target as HTMLElement).closest('a, button, input')) return;
    setSelectedId((current) => (current === id ? null : id));
    setPickerFor(null);
    setConfirmDeleteId(null);
  };

  const copy = async (message: DisplayChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text || message.attachment?.name || '');
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1400);
    } catch { /* The browser refused clipboard access: nothing to tell the person that they would not already see. */ }
  };

  const jumpTo = (id: string) => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    setTimeout(() => setFlashId((current) => (current === id ? null : current)), 1600);
  };

  const startEdit = (message: DisplayChatMessage) => {
    setEditingId(message.id);
    setEditDraft(message.text);
    setSelectedId(null);
    setPickerFor(null);
    setConfirmDeleteId(null);
  };

  const saveEdit = (message: DisplayChatMessage) => {
    const text = editDraft.trim();
    if (text && text !== message.text) onEdit?.(message.id, text);
    setEditingId(null);
  };

  const react = (id: string, emoji: string) => { onReact?.(id, emoji); setPickerFor(null); };

  const nameOf = (id: string) => (id === selfId ? 'You' : people[id]?.name ?? 'Someone who has left');

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
          {canClear && messages.length > 0 && onClearChat && (
            <button
              type="button" className={`chat-clear ${confirmClear ? 'is-confirming' : ''}`} aria-label={confirmClear ? 'Confirm: clear chat for everyone' : 'Clear chat for everyone'}
              title={confirmClear ? 'Click again to clear the chat for everyone' : 'Clear chat'}
              onClick={() => { if (confirmClear) { setConfirmClear(false); onClearChat(); } else setConfirmClear(true); }}
              onBlur={() => setConfirmClear(false)}
            >
              <Icon name={confirmClear ? 'check' : 'trash'} size={15} />{confirmClear && <span>Clear for everyone?</span>}
            </button>
          )}
          <button type="button" className="chat-close" onClick={closeAndReturnFocus} aria-label="Close chat"><Icon name="close" size={18} /></button>
        </div>
      </div>
      <div className="chat-messages" ref={listRef} role="log" aria-live="polite" onScroll={onListScroll} onClick={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
        {messages.length === 0 && <p className="chat-empty">{lessonChat ? 'Messages and files here are saved, and carry over to every future lesson of this class.' : `Messages${onSendFile ? ' and files' : ''} are only visible during this meeting.`}</p>}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const inRun = Boolean(previous) && previous.senderId === message.senderId && !message.replyTo && message.timestamp - previous.timestamp < RUN_MS;
          const title = people[message.senderId]?.title;
          const selected = selectedId === message.id;
          const reactionEntries = Object.entries(message.reactions ?? {}).filter(([, ids]) => ids.length > 0);
          const mayDelete = Boolean(onDeleteMessage && canDelete?.(message));
          const editing = editingId === message.id;
          const mayEdit = Boolean(onEdit) && message.own && Boolean(message.text);
          const showTools = interactive && !editing && (selected || pickerFor === message.id || confirmDeleteId === message.id);
          return (
            <div
              key={message.id} data-message-id={message.id}
              className={`chat-message ${message.own ? 'own' : ''} ${inRun ? 'is-run' : ''} ${selected ? 'is-selected' : ''} ${flashId === message.id ? 'is-flash' : ''} ${interactive ? 'is-interactive' : ''}`}
              onClick={interactive ? (event) => select(event, message.id) : undefined}
              role={interactive ? 'group' : undefined} aria-label={interactive ? `${message.own ? 'You' : message.name} at ${formatTime(message.timestamp)}` : undefined}
              aria-current={selected ? 'true' : undefined}
            >
              {inRun
                ? <time className="chat-message-gutter-time" dateTime={new Date(message.timestamp).toISOString()}>{formatTime(message.timestamp)}</time>
                : <span className="chat-avatar" style={{ background: `hsl(${hueOf(message.name)} 38% 38%)` }} aria-hidden="true">{initialsOf(message.name)}</span>}
              <div className="chat-message-body">
                {message.replyTo && (
                  <button type="button" className="chat-reply-preview" onClick={() => jumpTo(message.replyTo!.id)} aria-label={`Replying to ${message.replyTo.name}: ${message.replyTo.text || 'a message'}. Jump to it.`}>
                    <Icon name="reply" size={11} /><strong>{message.replyTo.name}</strong><span>{message.replyTo.text || 'Attachment'}</span>
                  </button>
                )}
                {!inRun && (
                  <div className="chat-message-meta">
                    <span className="chat-message-name">{message.own ? 'You' : message.name}</span>
                    {title && <span className="chat-title-badge">{title}</span>}
                    <time dateTime={new Date(message.timestamp).toISOString()}>{formatTime(message.timestamp)}</time>
                  </div>
                )}
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
                {editing ? (
                  <form className="chat-edit" onSubmit={(event) => { event.preventDefault(); saveEdit(message); }}>
                    <label className="sr-only" htmlFor={`chat-edit-${message.id}`}>Edit your message</label>
                    <input id={`chat-edit-${message.id}`} value={editDraft} maxLength={MAX_CHAT_LENGTH} autoComplete="off" autoFocus onChange={(event) => setEditDraft(event.target.value)} />
                    <span className="chat-edit-hint">Esc to cancel · Enter to save</span>
                    <button type="submit" className="chat-edit-save" disabled={!editDraft.trim()}>Save</button>
                    <button type="button" className="chat-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <MessageText text={message.text} links={linkifyMessages} />
                    {message.edited && <span className="chat-edited" title="This message was edited">(edited)</span>}
                  </>
                )}
                {reactionEntries.length > 0 && (
                  <div className="chat-reactions">
                    {reactionEntries.map(([emoji, ids]) => {
                      const mine = selfId !== undefined && ids.includes(selfId);
                      return (
                        <button
                          key={emoji} type="button" className={`chat-reaction ${mine ? 'is-mine' : ''}`} aria-pressed={mine}
                          aria-label={`${emoji} ${ids.length}: ${ids.map(nameOf).join(', ')}. ${mine ? 'Remove your reaction' : 'React the same'}`}
                          title={ids.map(nameOf).join(', ')} onClick={() => onReact?.(message.id, emoji)}
                        >
                          <span aria-hidden="true">{emoji}</span><span aria-hidden="true">{ids.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {confirmDeleteId === message.id && (
                  <div className="chat-delete-confirm" role="alertdialog" aria-label="Delete this message?">
                    <span>Delete this message for everyone?</span>
                    <button type="button" className="chat-delete-yes" onClick={() => { setConfirmDeleteId(null); onDeleteMessage?.(message.id); }}>Delete</button>
                    <button type="button" className="chat-delete-no" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                  </div>
                )}
              </div>
              {interactive && (
                <div className={`chat-tools ${showTools ? 'is-open' : ''}`} role="toolbar" aria-label="Message actions">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button key={emoji} type="button" className="chat-tool chat-tool-emoji" onClick={() => react(message.id, emoji)} aria-label={`React ${emoji}`} title={`React ${emoji}`}>{emoji}</button>
                  ))}
                  <button type="button" className="chat-tool" onClick={() => setPickerFor((current) => (current === message.id ? null : message.id))} aria-label="Add reaction" aria-expanded={pickerFor === message.id} title="Add reaction"><Icon name="smile" size={15} /></button>
                  {canChat && <button type="button" className="chat-tool" onClick={() => { setReplyingId(message.id); setSelectedId(null); inputRef.current?.focus(); }} aria-label={`Reply to ${message.own ? 'yourself' : message.name}`} title="Reply"><Icon name="reply" size={15} /></button>}
                  {mayEdit && <button type="button" className="chat-tool" onClick={() => startEdit(message)} aria-label="Edit message" title="Edit message"><Icon name="edit" size={15} /></button>}
                  {(message.text || message.attachment) && <button type="button" className="chat-tool" onClick={() => void copy(message)} aria-label="Copy text" title={copiedId === message.id ? 'Copied' : 'Copy text'}><Icon name={copiedId === message.id ? 'check' : 'copy'} size={15} /></button>}
                  {mayDelete && <button type="button" className="chat-tool chat-tool-danger" onClick={() => { setConfirmDeleteId(message.id); setPickerFor(null); }} aria-label="Delete message" title="Delete message"><Icon name="trash" size={15} /></button>}
                  {pickerFor === message.id && (
                    <div className="chat-emoji-picker" role="menu" aria-label="Choose a reaction">
                      {CHAT_REACTION_EMOJIS.map((emoji) => (
                        <button key={emoji} type="button" role="menuitem" className="chat-emoji" onClick={() => react(message.id, emoji)} aria-label={`React ${emoji}`}>{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {fileProblem && <p className="chat-file-problem" role="alert">{fileProblem}</p>}
      {sending && <p className="chat-file-sending" role="status">Sending {sending}…</p>}
      {replyingTo && (
        <div className="chat-replying" role="status">
          <Icon name="reply" size={13} />
          <span>Replying to <strong>{replyingTo.own ? 'yourself' : replyingTo.name}</strong>: {replyingTo.text || replyingTo.attachment?.name || 'a message'}</span>
          <button type="button" onClick={() => { setReplyingId(null); inputRef.current?.focus(); }} aria-label="Cancel reply"><Icon name="close" size={13} /></button>
        </div>
      )}
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
          placeholder={canChat ? (replyingTo ? 'Write your reply…' : 'Type a message…') : lessonChat ? 'The tutor has turned off chat for students' : 'The host has turned off chat'} onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="chat-send" disabled={!draft.trim() || !canChat} aria-label="Send message"><Icon name="send" size={17} /></button>
      </form>
      {dragging && <div className="chat-drop-hint" aria-hidden="true">Drop a file to share it</div>}
    </aside>
  );
}
