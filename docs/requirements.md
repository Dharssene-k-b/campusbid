# CampusBid Requirements

## Purpose and scope

CampusBid is a campus-only second-hand auction marketplace. A single student account can buy and sell. Auctions must be transparent and independent; this is not fixed-price e-commerce.

## Basic feature requirements

1. Students register, verify a college email address, log in, and log out.
2. Authenticated students can create, view, edit, and cancel their own eligible listings.
3. Listings contain item details, category, condition, multiple validated photos, starting price, minimum increment, and UTC closing time.
4. Marketplace search, filters, sorting, and pagination work together.
5. Auction pages display the current leading price, next valid bid, countdown, and public bid history using privacy-conscious bidder aliases.
6. Server-side bidding enforces starting price, increments, deadlines, auction status, seller restrictions, and concurrent-write safety. Money is stored in integer paise.
7. Auction closing is idempotent and server-driven. No-bid auctions become unsold; otherwise the leading bidder is provisional until the seller decides.
8. Seller approval reserves the item. Seller rejection, cancellation, failed pickup, and handover are recorded as distinct outcomes. Completion requires the defined parties' confirmation.
9. Persistent in-app notifications are deduplicated and link to relevant auctions.
10. Live updates follow successful persistence and reconnects refetch authoritative state.

## Advanced feature gate

Do not begin saved searches, Q&A, anti-sniping, automatic bidding, or AI assistance until the complete basic lifecycle and relevant basic tests pass.

## Advanced features

- Saved-search matching and deduplicated alerts
- Listing questions and seller answers with moderation controls
- Configurable last-minute extensions
- Publicly disclosed automatic-bid commitments and deterministic proxy-bid tie-breaking
- Optional AI search assistance; bids always require explicit user confirmation and pass through the normal bid engine

## Quality attributes

- Responsive, accessible UI with useful validation, loading, empty, and error states
- Server-side authorization, safe uploads, rate limits, secure sessions, and privacy-conscious logs
- UTC timestamps, integer paise comparisons, injectable clock for time-sensitive tests
- Setup that works on Windows PowerShell and cross-platform shells
