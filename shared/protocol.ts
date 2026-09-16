export interface MediaState { audio: boolean; video: boolean }
export interface Participant { id: string; name: string; media: MediaState }
export interface JoinRequest { roomId: string; name: string; media: MediaState }
export interface JoinedRoom { roomId: string; self: Participant; peer: Participant | null; sessionId: string | null; initiator: boolean }
export interface PeerJoined { peer: Participant; sessionId: string; initiator: boolean }
export interface SignalDescription { sessionId: string; description: RTCSessionDescriptionInit }
export interface SignalCandidate { sessionId: string; candidate: RTCIceCandidateInit }
export interface MeetingError { message: string }
export interface ClientToServerEvents {
  'room:join': (payload: JoinRequest) => void;
  'room:leave': () => void;
  'participant:media': (payload: MediaState) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export interface ServerToClientEvents {
  'room:joined': (payload: JoinedRoom) => void;
  'room:participant-joined': (payload: PeerJoined) => void;
  'room:participant-left': () => void;
  'room:full': (payload: MeetingError) => void;
  'room:error': (payload: MeetingError) => void;
  'participant:media': (payload: { id: string; media: MediaState }) => void;
  'webrtc:offer': (payload: SignalDescription) => void;
  'webrtc:answer': (payload: SignalDescription) => void;
  'webrtc:ice-candidate': (payload: SignalCandidate) => void;
}
export const ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{7,47}$/;
export const MAX_NAME_LENGTH = 40;
