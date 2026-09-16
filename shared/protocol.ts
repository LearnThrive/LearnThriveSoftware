export interface MediaState { audio: boolean; video: boolean }
export interface Participant { id: string; name: string; media: MediaState; screenSharing: boolean }
export interface JoinRequest { roomId: string; name: string; media: MediaState }
export interface JoinedRoom { roomId: string; self: Participant; peer: Participant | null; sessionId: string | null; initiator: boolean }
export interface PeerJoined { peer: Participant; sessionId: string; initiator: boolean }
export interface SignalDescription { sessionId: string; description: RTCSessionDescriptionInit }
export interface SignalCandidate { sessionId: string; candidate: RTCIceCandidateInit }
export interface MeetingError { message: string }
export interface ChatMessage { id: string; senderId: string; name: string; text: string; timestamp: number }
export interface ClientToServerEvents {
  'room:join': (payload: JoinRequest) => void;
  // Acknowledged so the client can wait for the server to actually process the departure
  // before tearing down the transport — emit-then-immediately-disconnect can otherwise lose
  // the message, leaving a ghost that later falsely announces "left" to a fast rejoin.
  'room:leave': (ack: () => void) => void;
  'participant:media': (payload: MediaState) => void;
  'participant:screen-share': (payload: { sharing: boolean }) => void;
  'chat:message': (payload: { text: string }) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export interface ServerToClientEvents {
  'room:joined': (payload: JoinedRoom) => void;
  'room:participant-joined': (payload: PeerJoined) => void;
  'room:participant-left': () => void;
  'room:participant-reconnecting': () => void;
  'room:participant-reconnected': (payload: Participant) => void;
  'room:full': (payload: MeetingError) => void;
  'room:error': (payload: MeetingError) => void;
  'participant:media': (payload: { id: string; media: MediaState }) => void;
  'participant:screen-share': (payload: { id: string; sharing: boolean }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export const ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{7,47}$/;
export const MAX_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 500;
