export interface MediaState { audio: boolean; video: boolean }
export type ParticipantRole = 'tutor' | 'student';
export interface Participant { id: string; name: string; media: MediaState; screenSharing: boolean; handRaised: boolean; role: ParticipantRole }
export interface WaitingParticipant { id: string; name: string }
export interface JoinRequest { roomId: string; name: string; media: MediaState; role: ParticipantRole }
// One entry per already-admitted participant the joiner needs a WebRTC connection to — replaces
// the old singular peer/sessionId/initiator now that a room can hold up to 4 admitted people.
export interface PeerEdge { peer: Participant; sessionId: string; initiator: boolean }
export interface JoinedRoom { roomId: string; self: Participant; peers: PeerEdge[]; waiting: WaitingParticipant[] }
export interface PeerJoined { peer: Participant; sessionId: string; initiator: boolean }
export interface SignalDescription { sessionId: string; description: RTCSessionDescriptionInit }
export interface SignalCandidate { sessionId: string; candidate: RTCIceCandidateInit }
export interface MeetingError { message: string }
export interface ChatMessage { id: string; senderId: string; name: string; text: string; timestamp: number }
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];
export interface ClientToServerEvents {
  'room:join': (payload: JoinRequest) => void;
  // Acknowledged so the client can wait for the server to actually process the departure
  // before tearing down the transport — emit-then-immediately-disconnect can otherwise lose
  // the message, leaving a ghost that later falsely announces "left" to a fast rejoin.
  'room:leave': (ack: () => void) => void;
  'room:admit': (payload: { id: string }) => void;
  'room:admit-all': () => void;
  'participant:media': (payload: MediaState) => void;
  'participant:screen-share': (payload: { sharing: boolean }) => void;
  'participant:hand': (payload: { raised: boolean }) => void;
  'participant:reaction': (payload: { emoji: string }) => void;
  'chat:message': (payload: { text: string }) => void;
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
  'room:participant-joined': (payload: PeerJoined) => void;
  'room:participant-left': (payload: { id: string; name: string | null }) => void;
  'room:participant-reconnecting': (payload: { id: string }) => void;
  'room:participant-reconnected': (payload: Participant) => void;
  'room:full': (payload: MeetingError) => void;
  'room:error': (payload: MeetingError) => void;
  'participant:media': (payload: { id: string; media: MediaState }) => void;
  'participant:screen-share': (payload: { id: string; sharing: boolean }) => void;
  'participant:hand': (payload: { id: string; raised: boolean }) => void;
  'participant:reaction': (payload: { id: string; emoji: string }) => void;
  'chat:message': (payload: ChatMessage) => void;
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
