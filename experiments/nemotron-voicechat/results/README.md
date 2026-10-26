# Generated results

Everything here is produced by a script or by the page's **Export results** button, and is git-ignored except this file.
The committed record is [../RESULTS.md](../RESULTS.md).

| File | Produced by | What it is |
| --- | --- | --- |
| `bench-*.json` | `npm run bench` | Per-run timings over the socket, with the aggregate median and p95 |
| `mock.log` | `npm run mock` | The stand-in's own log, including each barge-in it performed |
| `server.log` | `npm start` | The experiment server's log: event types and byte counts per connection, never audio and never a key |
| `audio/*.wav` | `node scripts/make-test-audio.mjs` | Synthetic speech for the phrase list, made with the app's existing Piper sidecar. Never a child, never a real recording |
| `nemotron-voicechat-*.json` | The page's **Export results** button | One session: config, counters, per-turn timings, the event list and the on-screen log |

The bench JSON's per-run detail is worth keeping: `clientBoundaryMs`, `serverBoundaryMs` and `packetDelayMs` are three
different boundaries of the same turn, and `firstAudioPacket` records the audio contract actually delivered
(sample rate, samples, packet length) rather than the one documented.
