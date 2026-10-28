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

## Current verified checks

- API integration suite: 5 tests passing (registration/verification, listing/search, valid/invalid/concurrent bids, closing and seller outcome paths, handover/notification behavior, ownership, cancellation history, and upload validation).
- Frontend suite: 1 marketplace test passing (empty state and category-filter request).
- Root lint, typecheck, and production build complete successfully.
- `npm audit`: zero known vulnerabilities at the latest check.

This is not the final basic-feature completion gate. Browser-level end-to-end coverage and additional edge cases still need to be added and run.
