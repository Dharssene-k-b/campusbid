# Architecture

## System

CampusBid uses an npm-workspaces monorepo:

- `apps/web`: React + Vite + TypeScript client
- `apps/api`: Express + TypeScript HTTP API, Socket.IO, and auction scheduler/reconciliation
- MongoDB: durable users, listings, accepted bids, notifications, and lifecycle records
- SMTP: expiring college-email verification links in production; development returns a clearly labelled one-time token instead
- Cloudinary: persistent production item photos; development can use a local ignored uploads folder

The browser is not authoritative. The API owns identity, authorization, price validation, server time, auction status, sale transitions, and persistence. Real-time messages are emitted only after database writes succeed; clients refetch authoritative state after reconnecting.

## Auction consistency

Accepted bids are immutable embedded records on each listing. Conditional atomic listing updates serialize competing bids without requiring a MongoDB replica set. Auction close and notification creation use conditional writes/idempotency keys. Startup and request-time reconciliation close expired auctions from server time, derive the provisional winner from valid persisted bids, and mark empty auctions unsold.

Photo selection and drag-and-drop share the same upload path, with five-photo, format, and 5 MB limits enforced by the client and API. Listing action controls reflect the persisted auction state; the API independently checks ownership and eligible state transitions.

## Identity and privacy

Passwords are hashed. Authenticated requests use secure, HTTP-only cookies. Registration is restricted to valid `@kongu.edu` student addresses, with one-time verification links delivered through the configured production email provider. Public bid history uses bidder aliases and does not expose account email or credentials.

## Deployment boundary

Web hosting, API hosting, MongoDB, image storage, SMTP, and optional AI providers are external deployment concerns. Do not deploy or incur paid costs without explicit approval.
