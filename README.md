# Bhivanta Social Media Marketing Agent — Setup, Deployment & Launch Checklist

## What this is (and is not)
A free-first, Node 24 stdlib + SQLite web agent for Facebook Pages + Instagram
Professional accounts. It does the full lifecycle *as far as a free, official-API
app honestly can*: Excel/CSV config → content queue → approval → scheduled
worker → comment-reply queue → daily summary → weekly CSV report → logs +
emergency stop. It is NOT a mockup: queue, validation, safety, dedupe,
scheduler, replies, reports and auth all run in code and are tested.

## One workflow (exactly as ordered)
1. **Upload Excel/CSV** — Download `/api/template.csv` and the CSVs in
   `templates/`. In Excel, fill one sheet per topic, then Save As CSV per
   sheet and upload each sheet here. Sheets: brand, products, prices,
   claims, faqs, audience, language, frequency, goals, preferences,
   response_rules, approval. Validation runs automatically; bad rows are
   rejected with the exact error, not silently accepted.
   - Direct .xlsx parsing is NOT included in this zero-dependency build.
     Adding it needs an Excel library; the CSV route is Excel-compatible
     and is the supported upload path for this build.
   - NEVER put passwords, tokens or OTPs in Excel. Tokens go only in
     the Connect form (encrypted) or host env, set by the owner.
2. **Connect Accounts — the 3 missing steps, solved INSIDE this agent**
   The Connect section (`/api/connect/status`, `/api/connect/save`,
   `/api/connect/verify`) is how the 3 steps are solved without leaving
   the agent:
   - Instagram: open the Instagram app → switch @bhivantaorganics from
     Personal to Professional (Business). Until then, Instagram is NOT
     professional and live Instagram publishing is blocked. This tap
     cannot be bypassed by any code — the agent does not fake it.
     After the tap, paste the real Business ID in the Connect form.
   - Facebook: create/link a Bhivanta Organics Page (Name, website,
     tagline as in the Connect instructions). Until then, the managed
     Pages list is empty and live Facebook publishing is blocked. The
     agent does not create a fake Page. After creation, paste the real
     Page ID in the Connect form.
   - Meta token: generate it from Meta with the minimum permissions
     listed below, paste it ONCE in the Connect form. The agent encrypts
     it (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY or ADMIN_PASSWORD)
     and stores it in its DB, never logs it, never returns it in
     plaintext, and verifies it against Graph `/me` on Verify click.
     Host env (META_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
     INSTAGRAM_BUSINESS_ID) still works as an alternative — env wins
     if both exist.
   - Auto-unlock: missing-steps are re-derived from env OR saved
     Connect values on every status/cycle, so as soon as all 3 are
     saved, live tasks unlock without a re-START. If a token is
     rejected by Graph, the agent reports it as invalid instead of
     pretending to publish.
3. **START AGENT** — One click. The agent validates, creates the initial
   content queue immediately (drafts, awaiting approval), and starts the
   hourly worker. If anything is missing, the dashboard lists the exact
   missing step instead of pretending to work. PAUSE pauses the worker,
   RESUME restarts it, EMERGENCY STOP stops everything.

## Permissions required (Meta)
- Facebook Page: pages_manage_posts, pages_read_engagement, pages_manage_metadata
  (as applicable), plus a Page access token. Instagram Professional:
  instagram_basic, instagram_content_publish, instagram_manage_comments,
  instagram_manage_insights (as applicable), linked to the Facebook Page.
  Exact scopes depend on Meta app review for the connected app; the agent
  never bypasses login, CAPTCHA, rate limits or app review.

## Costs — free-first, unavoidable costs disclosed
- This code: ₹0, zero paid dependencies.
- Hosting: free tiers have quotas (hours, invocations, build minutes).
  A host that sleeps will stop the worker — that is NOT 24×7 continuous
  execution, and this app never claims otherwise.
- Meta APIs: no platform fee for the APIs themselves in the normal case,
  but app review, business verification and any future paid tool are
  owner-approved only. No subscription is purchased by this app.
- If you need true always-on execution, that needs a paid always-on host
  or paid worker — owner approval required, not included here.

## Cannot be fully automated (honest list)
- Trending-audio attachment via Instagram API — API cannot attach music.
  Choose audio in the Instagram app at publish time. The queue marks this
  as NOT_SUPPORTED_VIA_API on every reel script.
- Certain inbox functions without the right Meta permissions/token.
- Live publishing without Page + Professional account + token + review.
- Continuous execution if the server/host stops or sleeps.
- Live trend/hashtag data without a connected trends API — hashtags in
  this build are suggested from your config + brand tags, not live trends.

## Safety (default)
- Approval ON by default. Low-risk auto-publish is OFF until the owner
  enables it in Settings, and even then only for approved wording that
  passes safety, never for promotions, price changes, new claims or
  unusual replies.
- Banned: certified / guaranteed / every-plant style claims, unverified
  prices, fake reviews, guaranteed growth results.
- Comments: sensitive (refund/legal/medical/safety/complaint) and
  uncertain (no exact FAQ match) are ESCALATED to the owner, never
  auto-answered with an invented answer. Replies use Hindi/Hinglish/
  English based on the comment language.
- Targets: first 7 days = baseline only (no invented numbers). After
  that, optimise for consistent posting, qualified engagement, leads and
  genuine sales — never fake followers or vanity metrics.

## Run locally
```
node server.js        # http://localhost:3000, login owner + ADMIN_PASSWORD (or admin123 demo only if env unset)
node --test tests/agent.test.js
```
## Deploy (free-first)
Any Node host that runs `node server.js` with a persistent disk for
data.db (SQLite). Set the env vars above in the host UI, never in the
repo. Keep the host awake only within its free quota; if it sleeps, the
worker pauses with it. Do NOT put this dashboard public without the
owner login + persistence + login-gate review in the launch checklist.

## Launch checklist
- [ ] Excel/CSV sheets uploaded and validated (brand, claims, faqs at minimum)
- [ ] Instagram switched to Professional (owner tap, verified)
- [ ] Facebook Page created/linked (verified, not empty list)
- [ ] META_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_BUSINESS_ID in host env
- [ ] ADMIN_PASSWORD set by owner in host env (not demo, not in chat)
- [ ] START clicked, initial queue created, missing-steps list = empty for live tasks
- [ ] First approval done, first daily summary checked, weekly CSV downloaded
- [ ] Baseline week (7 days) recorded with owner-entered analytics only
- [ ] Emergency Stop tested once before any live publish
