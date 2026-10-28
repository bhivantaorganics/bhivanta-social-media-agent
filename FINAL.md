# FINAL — Bhivanta Social Media Marketing Agent (Limited & Free, Daily Routine)

This is the FINAL version of the agent in this package. No new feature will
be added to this package without a new instruction from the owner.

## Final promise (and its limit)
- 100% free code, zero paid dependencies, spending ₹0, paid APIs OFF.
- Everything is LIMITED by code, not by promise: when a daily limit is
  reached, work stops for that day and resumes tomorrow. It never
  auto-upgrades, never buys quota, never spends.
- Daily routine only — NOT unlimited, NOT 24×7 continuous. The worker
  runs while the server runs; if the host sleeps/stops, the worker stops.

## Daily routine (fixed, every day)
- 09:00 Morning: aaj ke drafts banao (max 6), safety check, approval queue
- 14:00 Midday: approval queue reminder, comments check (max 20/day)
- 19:00 Evening: daily summary (max 1/day), kal ka plan, logs check
- Sunday: weekly CSV report (1/week), 7-day baseline review (entered data only, warna TBD)

## Hard limits (enforced in server.js, shown at /api/limits)
- Drafts: 6/day (Facebook + Instagram × feed, reel script, story)
- Comments: 20/day
- Uploads: 10/day
- Daily summary: 1/day, Weekly report: 1/week
- API verify: 20/day
- Spending: ₹0, Paid APIs: false
- Platforms: Facebook Pages + Instagram Professional only (WhatsApp excluded)

## Final workflow (unchanged, now final)
Upload Excel/CSV → Connect Accounts (3 steps, in-agent, encrypted) →
START AGENT → PAUSE / RESUME / EMERGENCY STOP.

## Still required from the owner (final, honest)
- Instagram Professional switch (owner tap in Instagram app)
- Facebook Page create/link
- Meta token (enter once in Connect form, encrypted)
Until those 3 are done, live publishing/inbox stay blocked and the agent
works for drafts, approvals, replies (queued) and reports only.

## Final test result
- Tests: 7/7 pass
- Smoke: START created exactly 6 drafts, draftsLeft became 0, second run
  creates 0 (limit + dedupe). No invented numbers, no pretend publish.
