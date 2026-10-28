# Decisions and Auction Policies

## Auction and sale state are separate

Bidding status: `Scheduled`, `Open`, `Closed`, or `Cancelled`.

Sale outcome: `Pending seller decision`, `Reserved`, `Awaiting handover`, `Completed`, `Rejected`, `Failed pickup`, `Unsold`, or `Cancelled`.

Valid main transitions:

- `Scheduled -> Open` when the scheduled start is reached.
- `Open -> Closed` at or after the authoritative deadline; no bids leads to `Unsold`, otherwise sale awaits seller decision.
- Closed auction with a provisional winner: seller approval leads to `Reserved -> Awaiting handover -> Completed` after required confirmation; rejection leads to `Rejected`.
- Eligible scheduled/open listing cancellation records actor and time, changes bidding status to `Cancelled`, preserves all bids, and prevents new bids.
- Failed pickup is recorded with actor and time, preserves the auction record, and does not falsely mark a sale completed.

Every transition must be authorized and idempotent where retried by a scheduler.

## Bidding

The first bid is at least the starting amount. Subsequent ordinary bids are at least the leading amount plus the listing minimum increment. Seller self-bidding is prohibited. The backend time and persisted auction state decide acceptance. Amounts are integer paise.

## Listing edits

Before any accepted bid, an owner may edit validated listing details. Once a bid exists, all listing edits are locked to avoid changing the auction terms or item representation after students have relied on them. The owner may cancel the auction; cancellation is recorded and preserves the bid history.

## Identity and privacy

Registration accepts valid Kongu college email addresses ending exactly in `@kongu.edu`; email is trimmed and normalized to lowercase before storage. Public bid history shows privacy-conscious aliases, never email or private contact information. Local verification is development-only.

## Advanced bid transparency

If automatic bidding is implemented, public maximum commitments must be disclosed according to an explicit policy before users enable it. Proxy-bid tie-breaking must be deterministic and tested. Assistant-suggested bids or maximums require explicit confirmation and use the same backend bidding engine.

## External services

Email, hosted image storage, and optional AI require environment configuration. A local development image fallback may be used, but untrusted arbitrary image URLs are not accepted. No paid deployment occurs without approval.
