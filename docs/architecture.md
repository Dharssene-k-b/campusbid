# Architecture

## System

CampusBid uses an npm-workspaces monorepo:

- `apps/web`: React + Vite + TypeScript client
- `apps/api`: Express + TypeScript HTTP API, Socket.IO, and auction scheduler/reconciliation
- MongoDB: durable users, listings, accepted bids, notifications, and lifecycle records

The browser is not authoritative. The API owns identity, authorization, price validation, server time, auction status, sale transitions, and persistence. Real-time messages are emitted only after database writes succeed; clients refetch authoritative state after reconnecting.

## Auction consistency

Accepted bids are immutable records. A listing's leading bid must be updated atomically with the accepted bid, using a conditional write or a transaction depending on the MongoDB topology. Auction close and notification generation are idempotent. Startup reconciliation closes expired open auctions.

## Identity and privacy

Passwords are hashed. Authenticated requests use secure, HTTP-only cookies. College email domains and production verification provider are configuration, not assumptions. Public bid history uses bidder aliases and does not expose account email or credentials.

## Deployment boundary

Web hosting, API hosting, MongoDB, image storage, SMTP, and optional AI providers are external deployment concerns. Do not deploy or incur paid costs without explicit approval.
