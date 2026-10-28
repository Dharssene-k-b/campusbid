# CampusBid

CampusBid is a campus-only second-hand auction marketplace for students. Each listing is an independent timed auction with a public bid history, minimum increment, seller decision, and recorded handover outcome.

> **Project status:** Basic API and responsive web interface are under active development. Authentication, listings, bidding, seller decisions, handover, notifications, and marketplace views are implemented locally. The complete basic-feature gate and all specified edge cases have not yet been verified; this is not production-ready.

## Planned features

- Student registration with Kongu email validation and verification
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

## API overview

- `POST /api/auth/register`, `/api/auth/verify`, `/api/auth/resend-verification`, `/api/auth/login`, and `/api/auth/logout`
- `GET /api/listings` with keyword, category, condition, effective-price, closing-soon, sorting, and pagination filters
- `POST /api/listings` and owner-scoped listing read/edit/cancel operations
- `POST /api/listings/:id/bids` for server-validated manual bids
- `POST /api/listings/:id/decision` for the seller decision after close
- Handover confirmation and failed-pickup routes under `/api/listings/:id/handover`
- `GET /api/notifications` and `POST /api/notifications/:id/read`

The authenticated dashboard returns the current student's listings, bids, and unread notification count.

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

Open the frontend at [http://localhost:5173](http://localhost:5173). The API health endpoint is [http://localhost:4000/api/health](http://localhost:4000/api/health). The Vite development server proxies API and Socket.IO requests to the local API.

Configure `.env` before starting. Generate a session secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The default MongoDB URI is for a local development database. For Atlas, set `MONGODB_URI` to the connection string in your local `.env`; do not commit it. Registration accepts only valid Kongu college addresses ending in `@kongu.edu`. Development verification returns a one-time token in the response and must never be treated as production email verification. Production startup requires `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `COOKIE_SECURE=true`; verification links expire after 24 hours.

Local development photos are content-sniffed, size-limited, and stored under the ignored `uploads/` folder. For persistent production photos, set `IMAGE_STORAGE_PROVIDER=cloudinary` and configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. AI is optional and is not required for the basic marketplace.

## Development and verification

```powershell
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

The API and web app have workspace-specific scripts in `apps/api/package.json` and `apps/web/package.json`.

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

Optional AI and production deployment require separately configured credentials. Local verification returns a development-only token and is not production email verification. The complete browser-level basic lifecycle and all specified edge cases remain to be verified.
