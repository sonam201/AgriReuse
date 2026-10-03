# AgriReuse demo

AI-style agricultural circular marketplace demo (climate hackathon). Synthetic data, simulated transactions.
Static Vite project: the whole app is in `index.html` (HTML, CSS, JS). No backend, no API keys needed.

## Run locally
    npm install
    npm run dev        # http://localhost:5173
    npm run build      # outputs dist/

## Deploy (free)
- Vercel: `npx vercel --prod` (project name `agrireuse-demo`), or import the repo at vercel.com.
- Netlify: build command `npm run build`, publish directory `dist`.
- Quick option without Node: drag only `index.html` (in its own folder) onto app.netlify.com/drop.

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
No automated tests yet; no listing editing after creation; no sensitivity table; no live Gemini function;
single-file code. Data lives in browser localStorage (Profile > Reset demo data).
