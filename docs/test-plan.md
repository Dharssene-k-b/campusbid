# Test Plan

## Unit tests

Test schema validation, money/paise conversion, bidding rules, auction state transitions, and clock-dependent logic using an injectable clock.

## API integration tests

Use an isolated test database and exercise authentication, verification, ownership, listing CRUD/cancellation, combined search filters, pagination, bid persistence, concurrent bids, auction closing, seller decisions, handover, and notification idempotency through HTTP routes.

## UI tests

Use React Testing Library for accessible forms, validation/error states, marketplace filters, bid history, and protected navigation.

## End-to-end tests

Where practical, use Playwright to register students, create and find a listing, bid, close an auction under a controlled clock, approve, and confirm handover.

## Required commands

Run lint, typecheck, unit/API tests, and production builds. Record actual commands and outcomes; do not represent unrun tests as passing.
