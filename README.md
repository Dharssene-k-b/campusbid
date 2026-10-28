# CampusBid

CampusBid is a campus-only second-hand auction marketplace for students. Each listing is an independent timed auction with a public bid history, minimum increment, seller decision, and recorded handover outcome.

> **Project status:** Repository initialized. Application features are being implemented in roadmap order; this is not yet a production-ready marketplace.

## Planned features

- Student registration with configurable college email verification
- Listing creation and management with validated photos
- Searchable marketplace, auction details, and public bid history
- Server-authoritative, concurrency-safe bidding
- Auction closing, seller approval, reservation, and handover
- Persistent notifications and live updates
- Saved-search alerts, listing Q&A, auction extensions, automatic bidding, and an optional AI assistant after the basic lifecycle passes its test gate

## Technology

- React, Vite, TypeScript, Tailwind CSS, and React Router
- Node.js, Express, TypeScript, Socket.IO, and Zod
- MongoDB and Mongoose
- Vitest, React Testing Library, Supertest, and Playwright where practical

## Architecture

The application is a simple npm-workspaces monorepo. The web client calls the Express API; the API is authoritative for identity, permissions, auction state, timestamps, bids, and sale transitions. MongoDB persists users, listings, bids, notifications, and workflow records. Socket.IO is used only to distribute persisted updates.

## Repository structure

```text
apps/
  api/       Express API
  web/       React client
docs/        Requirements, architecture, decisions, roadmap, and test plan
```

## Prerequisites

- Node.js 20 or newer and npm
- MongoDB locally or a MongoDB Atlas connection string

## Setup

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Configure `.env` before starting. Generate a session secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The default MongoDB URI is for a local development database. For Atlas, set `MONGODB_URI` to the connection string in your local `.env`; do not commit it. The allowed college email domains are configurable and are intentionally not assumed. Development verification must be clearly identified and must not be used as production email verification.

Image storage, SMTP email, and AI integrations are configured via environment variables. The AI assistant is optional and is not required for the basic marketplace.

## Development and verification

```powershell
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

The API and web app have workspace-specific scripts; see their package manifests once available.

## Auction rules

- The first bid must be at least the starting price.
- Every later manual bid must be at least the current leading bid plus the listing's minimum increment.
- The server clock, stored auction state, and database operation determine whether a bid is accepted.
- Sellers cannot bid on their own listings.
- Bids are durable history and are not deleted when a listing is cancelled.
- Auction closure is separate from seller approval and sale completion.

Detailed transitions and policies are documented in [docs/decisions.md](./docs/decisions.md).

## Security

Secrets belong in environment variables, never in source control. The API validates inputs and enforces authentication, ownership, and state transitions server-side. Production deployment requires HTTPS, secure cookies, a strict CORS allowlist, configured email verification, and restricted database access.

## Deployment

Deployment guidance will be added after local functionality and tests pass. No public deployment or paid service is authorized by repository setup.

## Known limitations

The application is not yet implemented. External email, image storage, and AI providers require separately configured credentials. No deployment has been performed.
