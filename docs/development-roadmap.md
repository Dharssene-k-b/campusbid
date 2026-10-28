# Development Roadmap

## Required implementation order

- [x] Phase 0: inspect workspace and initialize GitHub repository
- [x] Phase 0: initial planning commit pushed
- [ ] Phase 1: authentication and listing management (API, forms, SMTP verification, and local/Cloudinary photos implemented; broader verification in progress)
- [ ] Phase 2: browsing, auction details, and bidding (API and UI implemented; broader verification in progress)
- [ ] Phase 3: auction closing, seller decision, and sale completion (API and UI implemented; remaining edge-case verification in progress)
- [ ] Phase 4: persistent notifications and live updates (persistent notifications, scheduler, and authenticated Socket.IO updates implemented; broader verification in progress)
- [ ] Phase 5: verify complete basic lifecycle and edge cases
- [ ] Phase 6.1: saved-search alerts
- [ ] Phase 6.2: questions and answers
- [ ] Phase 6.3: last-minute auction extensions
- [ ] Phase 6.4: automatic bidding
- [ ] Phase 6.5: optional AI assistant
- [ ] Deployment preparation only after local application and tests pass

## Pushed milestones

- `d28b9ba` — initial project and planning documentation
- `4a98941` — student authentication, listing, auction API, and initial lifecycle tests
- `927f450` — responsive marketplace and student account UI
- `76470fb` — SMTP and Cloudinary configuration, expiring/resendable email verification, and API/UI tests
- `d0784ad` — increment-boundary and listing-edit lock coverage

The basic lifecycle remains in progress; the completion gate is not yet signed off. Work continues in feature-sized pushes.
## Milestone policy

Each milestone must be implemented, tested, and documented before it is marked complete. Do not start advanced features before the basic-feature completion gate passes. Do not claim a push, test, or deployment without verifying its result.
