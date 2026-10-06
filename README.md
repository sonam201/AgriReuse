# AgriReuse

A marketplace for New Zealand farm waste. Farmers list what they have left over, such as overripe produce, crop residues or pomace. AgriReuse matches each listing with businesses that can reuse it, such as composters, worm farms, feed users and processors. Every listing gets a safety and biosecurity check, and before a deal is agreed both sides see the cost and the carbon savings.

Built for a climate hackathon. **Payments are simulated:** no real money is collected, held or released.

## What it does

| Area | What you can do |
| --- | --- |
| **Landing and accounts** | Landing page, sign up with an email confirmation link, sign in, forgot password. One account can sell (Supplier), buy (Receiver) or both. |
| **Create Listing** | Describe the material in a **chat** (typing or voice) or fill in a **form**. Free AI (Groq) pulls out the details, and a compliance check asks the safety questions for that kind of material. |
| **Matches** | For each of your listings, the businesses on the other side that fit, with a score out of 100 and the reasons. Send a deal request from any match. |
| **Marketplace** | Browse supply listings (buyers) or requests (sellers), even ones that aren't a match, and send a deal request. Shows 5 per page. |
| **Deals** | Requests can be approved, declined or countered on price and amount. Once approved, the deal has 3 steps: **Pickup arranged** (seller) → **Received** (buyer enters the actual tonnes) → **Completed** (seller). |
| **Dashboard** | What's waiting on you, your listings, what the market is paying, your results and a weekly CO₂e chart. |
| **Impact** | Community totals, your contribution, breakdown by kind of material and the latest exchanges. |
| **Notifications** | The 🔔 bell, only for deal requests, counter-offers and new exchanges. |
| **Profile** | Business details, turning on the other role, and deleting your own data one part at a time. |

The layout works on phones: below 768px wide the navigation moves into a ☰ menu. Confirmations such as deletes and cancelling a deal use in-app popups.

### How matching works

A supply listing and a request match when the **material fits**: they share a keyword, the material's category is one the buyer accepts, or the buyer takes any kind. A match is blocked if the town is unknown, the compliance check says *Not allowed*, or nothing is left to sell. Matches you can't use, such as your own listings, private or archived ones, or uses the compliance check rules out, are hidden.

Each match gets a score out of 100, with up to 20 points for each of **material, use, timing, amount and price**. Soft notes flag things worth knowing, such as dates that don't overlap or a price above the buyer's budget.

### How CO₂e is estimated

```
net CO₂e (kg) = tonnes × 450      (landfill emissions avoided)
              + tonnes × 0.7 × 60 (product it replaces)
              − transport          (trips × road km × 2 ways × 0.9)
              − tonnes × 20        (processing)
```

Road km = straight-line distance × 1.3. A ±40% range is shown. The factors are illustrative only, not sourced or certified (`EF` in [lib/data.ts](lib/data.ts)). A completed deal is calculated on the tonnes actually received, and the figures are stored so they don't change later.

## Tech stack

- **Next.js 16** (App Router), **React 19** and **TypeScript**
- **Supabase**: Postgres with row-level security, auth, realtime, and SECURITY DEFINER functions for every deal action
- **Groq** (free tier, OpenAI-compatible, model `openai/gpt-oss-20b`) for reading listings, called only from the server in [app/api/parse-listing/route.ts](app/api/parse-listing/route.ts). The limit is 20 requests per hour per user. Without a key, the app falls back to keyword rules.

## Project layout

```
app/
  page.tsx                  landing page
  app/page.tsx              the signed-in app (/app)
  api/parse-listing/        server route that calls the AI
  globals.css               all styles
components/
  App.tsx                   state, actions, header / menu / tab bar
  views/                    one component per tab (Dashboard, CreateListing, Marketplace, Matches, Transactions, Impact, Profile)
  ListingChat.tsx           chat-style listing assistant
  Compliance.tsx            safety questions
  OffersPanel.tsx, RequestDialog.tsx   deal requests
  Dialog.tsx                in-app confirm popup
  Pager.tsx                 5-per-page pagination
lib/
  logic.ts                  matching, scores, deal steps, economics, CO₂e
  compliance.ts             safety rules by material category
  data.ts                   towns, emission factors, labels
  db.ts                     all Supabase reads and writes
  types.ts                  shared types
supabase/
  migrations/               database schema and changes, in date order
  seed.sql                  fictional demo businesses
  *.sql                     one-off maintenance scripts (see below)
  email-templates/          sign-up confirmation email
scripts/generate-seed.ts    builds seed.sql
```

## Running it locally

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill it in:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, from Supabase → Project Settings → API
   - `GROQ_API_KEY` (optional), a free key from https://console.groq.com/keys. Keep it server-side and never prefix it with `NEXT_PUBLIC_`.
3. Set up the database (see the next section).
4. Run `npm run dev` and open http://localhost:3000.

For a production build, run `npm run build && npm start`.

## Database setup

The database is a hosted Supabase project. The SQL is pasted into **Supabase → SQL Editor → Run**; the Supabase CLI is not used.

- **New project:** generate `SETUP.sql` (it is gitignored). It contains `migrations/…_init.sql`, then `seed.sql`, then every other migration in date order. Paste it all in and run it once.
- **Existing project:** run only the migrations in [supabase/migrations/](supabase/migrations/) that haven't been run yet, oldest first.

In **Authentication → Providers → Email**, keep **Confirm email** turned on so sign-up sends the confirmation link. Add your site URL under **Authentication → URL Configuration**.

Maintenance scripts (each is run the same way):

| Script | What it does |
| --- | --- |
| `reset-marketplace.sql` | Empties all listings, deals, offers and notifications for everyone. Accounts are kept. |
| `remove-demo-data.sql` | Removes the fictional seeded businesses. |
| `restore-demo-data.sql` | Brings them back. |
| `cleanup-test-data.sql` | Removes test accounts named "QA …". |

## Deploying

Import the repo on Vercel (Next.js is detected automatically). Add the same three environment variables, then add the deployed URL to Supabase's URL Configuration so the email links point to it.

## What's simulated, and the limits

- **Payments**: simulated; no money moves.
- **Compliance check**: guidance based on the answers given, not certification. The fruit-fly zone hook is kept so a live MPI feed can be connected later.
- **Distances**: straight-line × 1.3 between 10 known towns, so they are indicative only.
- **Emission factors**: illustrative only, and no carbon credits are issued.
- **Verification**: a simulated step.
- **Not yet built**: automated tests, real payments, live biosecurity data, and admin tools.
