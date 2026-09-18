export interface MediaState { audio: boolean; video: boolean }
export type ParticipantRole = 'tutor' | 'student';
// forceMuted is a server/tutor-authoritative directive layered on top of media.audio, which stays
// 100% client-self-reported as before — the two are deliberately independent (never clamp one
// from the other) so a broadcast never lies about what a track is actually doing. See
// PRODUCTION_GAPS.md for why force-mute can only ever be a directive a client complies with, not
// real media-path enforcement, in a P2P (non-SFU) architecture.
// handRaisedAt (server timestamp, null while lowered) drives the tutor-only Help Queue's
// time-raised ordering and elapsed-time display — see ClassControlsMenu.tsx's HelpQueue.
export interface Participant {
  id: string; name: string; media: MediaState; screenSharing: boolean; handRaised: boolean; handRaisedAt: number | null;
  role: ParticipantRole; forceMuted: boolean;
}
export interface WaitingParticipant { id: string; name: string }
export interface JoinRequest { roomId: string; name: string; media: MediaState; role: ParticipantRole }
// One entry per already-admitted participant the joiner needs a WebRTC connection to — replaces
// the old singular peer/sessionId/initiator now that a room can hold up to 4 admitted people.
export interface PeerEdge { peer: Participant; sessionId: string; initiator: boolean }

export interface RoomSettings { locked: boolean; studentsCanShareScreen: boolean; studentsCanChat: boolean }

export interface PollOption { id: string; text: string }
export type PollVisibility = 'always' | 'onClose';
// Personalized per recipient by the server — never the same object sent to everyone. `results`
// is null while hidden from this recipient; `voters` is present only for the tutor on a
// non-anonymous poll. See CLASSROOM_FEATURES.md for the exact visibility matrix.
export interface PollState {
  id: string; question: string; options: PollOption[]; anonymous: boolean; open: boolean; resultsVisible: PollVisibility;
  results: Record<string, number> | null;
  myVote: string | null;
  totalVotes: number;
  voters?: { id: string; name: string; optionId: string }[];
}

export type UnderstandingStatus = 'understood' | 'confused' | 'lost';
// Also personalized: `responses`/`summary` are present only for the tutor. A student only ever
// sees their own submitted status, never anyone else's or an aggregate — deliberately, to avoid
// peer-pressure/comparison dynamics on what's meant to be a private "I need help" signal.
export interface UnderstandingCheckState {
  id: string; open: boolean; myStatus: UnderstandingStatus | null;
  responses?: { id: string; name: string; status: UnderstandingStatus | null }[];
  summary?: Record<UnderstandingStatus, number>;
}

export type TimerMode = 'stopwatch' | 'countdown';
// Broadcast only on state transitions (start/pause/resume/stop), never a per-second tick — each
// client computes its own live display off `anchorAt` locally, the same pattern MeetingTimer
// already uses off `connectedAt`.
// While running, elapsed = now - anchorAt (ticked locally by each client). While paused,
// elapsed is frozen at elapsedAtPauseMs instead. Countdown remaining = durationMs - elapsed.
export interface RoomTimerState { mode: TimerMode; anchorAt: number; durationMs: number | null; paused: boolean; elapsedAtPauseMs: number | null }

export type BoardBackground = 'blank' | 'lined' | 'grid' | 'dotted' | 'coordinate';
// The server treats a board element as an opaque bag of properties — it only ever reads
// id/version/versionNonce/isDeleted (for reconciliation, the same version/versionNonce merge
// strategy Excalidraw's own collaboration reference implementation uses) and never interprets or
// validates the drawing-specific fields. Excalidraw's actual element schema lives entirely
// client-side; the server is deliberately schema-blind to it.
export interface BoardElement { id: string; version: number; versionNonce: number; isDeleted?: boolean; [key: string]: unknown }
export interface BoardPage { id: string; name: string; background: BoardBackground }
// Not personalized (unlike polls/understanding checks) — every participant sees the same board
// state, so this is broadcast/embedded as-is. Every page's elements are included up front so
// switching pages is a pure local operation with no server round-trip.
export interface BoardState { pages: BoardPage[]; activePageId: string; elementsByPage: Record<string, BoardElement[]>; studentsCanDraw: boolean }

// A single active announcement per room (like the poll/understanding-check/timer, not a queue or
// chat history) — the tutor sending a new one replaces the last, and it auto-expires server-side
// after ANNOUNCEMENT_TTL_MS so it genuinely disappears for everyone rather than just fading
// locally. Deliberately separate from chat, which it must never pollute (see plan section 33).
export interface Announcement { id: string; text: string; sentAt: number }

export interface JoinedRoom {
  roomId: string; self: Participant; peers: PeerEdge[]; waiting: WaitingParticipant[];
  settings: RoomSettings; poll: PollState | null; understandingCheck: UnderstandingCheckState | null; timer: RoomTimerState | null;
  board: BoardState; announcement: Announcement | null;
}
export interface PeerJoined { peer: Participant; sessionId: string; initiator: boolean }
export interface SignalDescription { sessionId: string; description: RTCSessionDescriptionInit }
export interface SignalCandidate { sessionId: string; candidate: RTCIceCandidateInit }
export interface MeetingError { message: string }
export interface ChatMessage { id: string; senderId: string; name: string; text: string; timestamp: number }
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '❓'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];
export interface ClientToServerEvents {
  'room:join': (payload: JoinRequest) => void;
  // Acknowledged so the client can wait for the server to actually process the departure
  // before tearing down the transport — emit-then-immediately-disconnect can otherwise lose
  // the message, leaving a ghost that later falsely announces "left" to a fast rejoin.
  'room:leave': (ack: () => void) => void;
  'room:admit': (payload: { id: string }) => void;
  'room:admit-all': () => void;
  'room:deny': (payload: { id: string }) => void;
  'room:settings': (payload: Partial<RoomSettings>) => void;
  'room:mute-participant': (payload: { id: string }) => void;
  'room:mute-all': () => void;
  'room:allow-unmute': (payload: { id: string }) => void;
  'room:remove-participant': (payload: { id: string }) => void;
  'room:allow-rejoin': (payload: { name: string }) => void;
  'room:stop-share': (payload: { id: string }) => void;
  'room:lower-hand': (payload: { id: string }) => void;
  'participant:media': (payload: MediaState) => void;
  'participant:screen-share': (payload: { sharing: boolean }) => void;
  'participant:hand': (payload: { raised: boolean }) => void;
  'participant:reaction': (payload: { emoji: string }) => void;
  'chat:message': (payload: { text: string }) => void;
  'chat:delete': (payload: { id: string }) => void;
  'chat:clear': () => void;
  'poll:create': (payload: { question: string; options: string[]; anonymous: boolean; resultsVisible: PollVisibility }) => void;
  'poll:vote': (payload: { optionId: string }) => void;
  'poll:close': () => void;
  'poll:clear': () => void;
  'understanding:start': () => void;
  'understanding:respond': (payload: { status: UnderstandingStatus }) => void;
  'understanding:end': () => void;
  'timer:start': (payload: { mode: TimerMode; durationMs: number | null }) => void;
  'timer:pause': () => void;
  'timer:resume': () => void;
  'timer:stop': () => void;
  'board:update': (payload: { pageId: string; elements: BoardElement[] }) => void;
  'board:cursor': (payload: { x: number; y: number }) => void;
  'board:laser': (payload: { x: number; y: number }) => void;
  'board:page-create': () => void;
  'board:page-rename': (payload: { pageId: string; name: string }) => void;
  'board:page-delete': (payload: { pageId: string }) => void;
  'board:page-reorder': (payload: { pageIds: string[] }) => void;
  'board:page-switch': (payload: { pageId: string }) => void;
  'board:background': (payload: { pageId: string; background: BoardBackground }) => void;
  'board:permission': (payload: { studentsCanDraw: boolean }) => void;
  'board:clear': (payload: { pageId: string }) => void;
  'board:follow-me': () => void;
  'board:import': (payload: { pageId: string; elements: BoardElement[] }) => void;
  'announce:send': (payload: { text: string }) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export interface ServerToClientEvents {
  'room:joined': (payload: JoinedRoom) => void;
  // Sent instead of room:joined while a student is waiting for the tutor to admit them.
  'room:waiting': (payload: { roomId: string }) => void;
  // Tutor-only: the full current waiting list (a full-list replace, not a diff — the waiting
  // room is small and capped, so there's no ordering/patch complexity worth taking on).
  'room:waiting-update': (payload: { waiting: WaitingParticipant[] }) => void;
  // Tutor-only ack for room:admit/room:admit-all, so Admit All can report a partial result.
  'room:admit-result': (payload: { admitted: number; remaining: number }) => void;
  // Sent to a student instead of room:joined/room:waiting-update when the tutor declines them.
  'room:denied': () => void;
  'room:settings-update': (payload: RoomSettings) => void;
  'room:participant-joined': (payload: PeerJoined) => void;
  'room:participant-left': (payload: { id: string; name: string | null }) => void;
  'room:participant-reconnecting': (payload: { id: string }) => void;
  'room:participant-reconnected': (payload: Participant) => void;
  // Sent only to a participant the tutor has just removed, before their transport is closed.
  'room:removed': () => void;
  // Tutor-only: the full current list of removed-and-not-yet-allowed-back names, a full-list
  // replace like room:waiting-update. Never sent to students — who was removed is tutor-only
  // information, same reasoning as anonymous poll voter identity.
  'room:removed-list-update': (payload: { names: string[] }) => void;
  // Sent to every remaining admitted participant and every still-waiting student when the tutor
  // departs — replaces room:participant-left for this case rather than firing alongside it.
  'room:ended': () => void;
  // Directive sent only to the participant whose share the tutor is stopping; they call their
  // own existing stop-sharing path. The room-wide state change is the existing
  // participant:screen-share broadcast, unchanged.
  'room:stop-share': () => void;
  'room:full': (payload: MeetingError) => void;
  'room:error': (payload: MeetingError) => void;
  'participant:media': (payload: { id: string; media: MediaState }) => void;
  'participant:screen-share': (payload: { id: string; sharing: boolean }) => void;
  'participant:hand': (payload: { id: string; raised: boolean }) => void;
  'participant:reaction': (payload: { id: string; emoji: string }) => void;
  // Broadcast to everyone including the target, unlike the self-report events above — the tutor
  // (the actor) and the target (the subject) are different people here, so neither side updates
  // optimistically; both wait for this, same as any other room-state broadcast.
  'participant:force-muted': (payload: { id: string; forceMuted: boolean }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'chat:message-deleted': (payload: { id: string }) => void;
  'chat:cleared': () => void;
  'poll:update': (payload: PollState | null) => void;
  'understanding:update': (payload: UnderstandingCheckState | null) => void;
  'timer:update': (payload: RoomTimerState | null) => void;
  // Full-state resend, used both for the initial post-admission snapshot and a reconnect resync
  // (same shape as the rest of room:joined's personalized-extras pattern).
  'board:snapshot': (payload: BoardState) => void;
  // The reconciled subset of `elements` actually accepted (stale/rejected elements are silently
  // dropped, never broadcast) — never sent back to the sender, who already applied them locally.
  'board:update': (payload: { pageId: string; elements: BoardElement[] }) => void;
  'board:cursor': (payload: { id: string; name: string; x: number; y: number }) => void;
  'board:laser': (payload: { id: string; x: number; y: number }) => void;
  'board:pages-update': (payload: { pages: BoardPage[]; activePageId: string }) => void;
  'board:permission-update': (payload: { studentsCanDraw: boolean }) => void;
  'board:cleared': (payload: { pageId: string }) => void;
  'board:follow-me': () => void;
  'announce:update': (payload: Announcement | null) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export const ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{7,47}$/;
export const MAX_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 500;
export const MAX_STUDENTS = 3;
export const MAX_PARTICIPANTS = MAX_STUDENTS + 1;
// Abuse-prevention only — the admitted-participant cap is enforced independently and is what
// actually matters; this just stops an unbounded number of sockets piling up unadmitted.
export const WAITING_ROOM_CAP = 10;
export const MAX_POLL_QUESTION_LENGTH = 200;
export const MAX_POLL_OPTION_LENGTH = 80;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 6;
export const MAX_BOARD_PAGES = 20;
export const MAX_BOARD_PAGE_NAME_LENGTH = 40;
// Per-page element cap and a per-message batch cap — generous for a 4-person classroom board,
// tight enough that a malicious/buggy client can't grow a room's memory unboundedly.
export const MAX_BOARD_ELEMENTS_PER_PAGE = 5000;
export const MAX_BOARD_UPDATE_BATCH = 200;
// A single element's serialized JSON size — generous for real drawing data (freehand strokes can
// carry hundreds of points), tight enough to reject an obviously abusive payload.
export const MAX_BOARD_ELEMENT_BYTES = 200_000;
export const MAX_BOARD_IMPORT_BYTES = 5_000_000;
export const MAX_ANNOUNCEMENT_LENGTH = 200;
export const ANNOUNCEMENT_TTL_MS = 15_000;
