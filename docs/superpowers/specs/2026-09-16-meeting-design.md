# LearnThrive meeting prototype design

The user's supplied 36-section brief is the approved scope. All project writes stay in D:\LearnThriveSoftware; D:\LearnThrive is a read-only brand reference. No deployment or public tunnel is started by implementation.

React renders a pre-join preview, an active two-person room, and an ended state. A media controller owns local tracks and a meeting controller owns Socket.IO and a single peer connection. The first member creates the only offer. A server-created pair session ID rejects stale signalling after departure, reconnect, or replacement. ICE is queued until the remote description is applied. Audio and video sendrecv transceivers also support participants initially joining without devices. Track enabled state handles routine mute; replaceTrack attaches subsequently permitted media.

Express and Socket.IO only relay typed, validated signalling within two-member in-memory rooms. Disconnect deletes membership; empty rooms disappear. Local tracks remain active when a remote participant departs. Signalling reconnection rejoins the room and negotiates a fresh pair. Real WebRTC state, separate from Socket.IO state, drives connection labels.

Vite proxies /socket.io on the current origin, including WebSockets. Both local services bind to loopback. A documented exact TUNNEL_HOST allowlist permits a single optional temporary HTTPS Cloudflare tunnel. No credentials are committed. STUN is the default; optional TURN is configured centrally through environment values.

Native CSS follows the existing navy, green, mint, cream and typography. Semantic labelled controls, live status text, focus indicators and responsive layouts cover 390, 768, 1024 and 1440 pixels. Optional device selectors are deferred to keep the media lifecycle focused. No recording, chat, screen sharing, database or accounts.

Verification includes real Socket.IO room tests, TypeScript/lint/build, and Chromium same-machine browser tests using synthetic media where possible. Physical camera, microphone and two-device verification must be reported separately and never inferred from synthetic media.
