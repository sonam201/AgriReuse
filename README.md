# AgriReuse demo

AI-style agricultural circular marketplace demo (climate hackathon). Synthetic data, simulated transactions.
Next.js (App Router, TypeScript) project. Client-side only: no backend, no API keys needed.
- `lib/`: types, seed data, matching / safety gate / economics / CO2e logic, scripted assistant parser
- `components/App.tsx`: state, persistence and actions; `components/views/`: one component per tab
- `app/`: layout, page, global styles

## Run locally
    npm install
    npm run dev                  # http://localhost:3000
    npm run build && npm start   # production

## Deploy (free)
- Vercel: `npx vercel --prod` (project name `agrireuse-demo`), or import the repo at vercel.com (Next.js is auto-detected).
- Netlify: import the repo; the Next.js runtime is detected automatically.

## Implemented
Create Listing (scripted Demo assistant + optional browser voice input), 50 supply / 40 demand listings,
Safety & Biosecurity Gate (eligible / restricted / blocked), two-way matching with visible score weights,
logistics, supplier/receiver economics, CO2e estimate with range, simulated 7-step transaction with
cancel/dispute, notifications, dashboard, impact, local persistence, Reset demo data.

## Simulated
Assistant parsing (not a live AI), payments (no real funds), safety scenarios (not certification),
distances (straight-line x multiplier, indicative only), emission factors (illustrative, not sourced),
all businesses (fictional). No carbon credits.

## Known limitations
No automated tests yet; no listing editing after creation; no sensitivity table; no live Gemini function. Data lives in browser localStorage (Profile > Reset demo data).
