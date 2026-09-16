# Production Gaps

This document lists what stands between this prototype and real use with LearnThrive students, parents and tutors. **Nothing here is implemented in this task, and nothing here should be inferred as "in progress" — these are gaps, not a roadmap commitment.**

## Identity and access

- **Authentication.** There is none. A display name is a self-declared string with no verification.
- **Parent/student/tutor identity.** No concept of roles or accounts exists at all; every participant is interchangeable.
- **Scheduled lesson authorisation.** Anyone with a room code can join at any time; there is no link between a room and a specific booked lesson, time window, or pair of people.
- **Expiring room credentials.** Room codes are permanent for the lifetime of the (in-memory) server process. Production needs server-issued, time-limited, single-lesson credentials rather than a bearer code.
- **Room authorisation.** The server enforces a 2-participant cap and room isolation (verified by an adversarial review, twice, during this build), but it does not enforce *who* those two participants are allowed to be.

## Infrastructure

- **Production signalling hosting.** The signalling server runs as a local dev process (`tsx watch`) on loopback. Production needs a hosted, supervised, horizontally-scalable deployment with a real process manager and restart policy.
- **Managed TURN.** STUN-only by default; TURN is supported via environment variables but no TURN service is provisioned, purchased, or operated by this project. Real-world NAT/firewall traversal at scale needs a managed or self-hosted TURN service with credential rotation.
- **Production HTTPS/domain.** Local development uses `localhost`/loopback, or a temporary Cloudflare Quick Tunnel for manual two-device testing. Neither is a production origin, certificate, or domain strategy.
- **Availability monitoring.** Nothing watches whether the signalling server is up, degraded, or leaking memory over time.
- **Backups / config recovery.** There is no persistent state to back up today (rooms and chat are intentionally in-memory and ephemeral), but as soon as any persistent identity/scheduling data is added, it will need a real backup and recovery plan.

## Abuse and safety

- **Abuse controls.** Beyond input validation and room-membership scoping, there are no controls against a participant behaving badly once inside a room (no reporting, no blocking, no moderation).
- **Production rate limits.** The chat rate limiter is a lightweight, per-connection anti-spam measure (documented in README.md's Current Limitations), not a production-grade control — it resets on reconnect and isn't tied to any durable identity. Signalling events (offers/answers/ICE/media/screen-share) have no rate limiting at all beyond the transport-level message size cap. Production needs abuse-resistant limits tied to authenticated identity, not just a live socket id.
- **Safeguarding integration.** For a platform used by students (potentially minors), there is no safeguarding policy integration: no recording-for-safety option, no supervisory visibility, no incident reporting path. This is a policy and product decision, not just an engineering one, and needs to happen before real lessons run through this or any successor system.
- **Data protection review.** No formal review of what data is collected (currently: transient display names and ephemeral chat text, nothing persisted) against applicable data protection requirements (e.g., UK GDPR, given the target audience).
- **Legal review before handling live students.** Beyond data protection specifically, a full legal/compliance review is needed before any real tutoring session runs through this system — this covers safeguarding obligations, terms of service, consent, and liability, none of which this prototype addresses.

## Observability

- **Observability.** No structured production logging, metrics, tracing, or alerting exists beyond categorised `console.*` output intended for a developer's own browser devtools during local testing. Production needs centralised logs, connection-quality metrics aggregated across real sessions, and alerting on signalling-server health.

## Browser/device coverage

- **Final Safari/iOS testing.** This prototype was built and automated-tested on Windows (Chrome and Firefox via Playwright). Safari and iOS Safari have not been tested at all — see [TESTING.md](TESTING.md)'s test matrix. Given LearnThrive students plausibly join from iPhones/iPads, this is a real gap to close before considering any wider trial, not just a formality.

## What this prototype does establish

To be clear about what *is* already solid, so the gaps above are read in context: room isolation, session-pairing staleness rejection, 2-participant capacity enforcement, and the new chat/screen-share/device surface have all been through adversarial security review (twice) with no must-fix issues found. The reliability work (reconnection, negotiation correctness, leave/rejoin) has real regression tests, not just manual spot checks. The gap is specifically the *production* concerns above — identity, hosting, abuse-resistance at scale, and safety policy — not the core WebRTC/signalling architecture itself.
