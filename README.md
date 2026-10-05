# AgeWell — full website, ONE Vercel variable

The full landing page, dashboard preview, launch announcement, working waitlist, weekly coordination planner, API code and database setup are included. Only `GEMINI_API_KEY` is required in Vercel.

## Setup

1. Extract the ZIP. Upload ALL files and folders to your GitHub repository, replacing the old project files. Keep `index.html` at the root. No build command is required; use Vercel framework **Other**.
2. Open the EXISTING AgeWell Supabase project's SQL Editor. Paste and run `supabase/setup.sql` once. It installs the new restricted functions and adds a request-token hash column; it does not delete existing records. If your tables differ from the included schema, fix any SQL error before continuing.
3. In Vercel > Settings > Environment Variables, add `GEMINI_API_KEY` as a Secret for Production.
4. Redeploy. Test **Try AgeWell > Use a sample routine > consent > Create my weekly plan**, then check the new completed record in Supabase `care_requests`.

You do NOT need `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `VISITOR_SECRET`, or `APP_ORIGIN` in Vercel. Old variables can be left unused or removed manually. The public Supabase URL/key are included in `lib/supabase-config.js` and the browser waitlist code. Never replace them with a database secret key. No private keys are included in this ZIP.

Default Gemini model: `gemini-3.5-flash-lite`. If unavailable to your key, edit the default model string in `lib/planner.js`; no additional variable is necessary. An optional `GEMINI_MODEL` override remains supported.

## How it works

- Browser -> `/api/care-plan` on Vercel.
- Vercel uses the public Supabase key to reserve an anonymous draft with a random, single-request write token.
- Vercel calls Gemini using its private environment variable, validates assignments, and saves the result through a restricted Supabase function.
- Only a hash of the write token is stored. The token stays inside the server function, is scoped to one pending record, expires after 30 minutes, and is invalidated when finalized. It is never returned to the browser or model.
- Public visitors cannot select, update or delete rows directly. Public functions return only signup confirmation, a new reservation ID, save confirmation, or aggregate counts.
- Waitlist registration calls Supabase directly. It needs neither Vercel nor Gemini.

## Limitations — coursework demonstration, not a clinical service

Because the public key and logging functions are callable by anyone, an attacker can reserve their own draft and submit structurally valid records. The database cannot independently verify that Gemini generated a record or token-usage count. Saved-draft totals are demo activity, not audited AI usage or clinical outcomes. Public clients can also consume the daily reservation/signup allowance. Quotas constrain abuse but do not replace authentication, verified CAPTCHA or monitoring. Visitor/network hashes deter ordinary repeat requests but are not authenticated identities for direct public callers.

No medical free text is stored. The database strips unknown fields and accepts fixed anonymous tasks only. Do not use this demonstration for actual medical records or personally identifying health data. The illustrative dashboard does not represent live care. No reminders, emails or appointment bookings are sent.

The redesign is delivered as source code, not deployed automatically. All 14 local API/validation tests passed, and the setup SQL was tested in a temporary local PostgreSQL runtime for anonymous access restrictions, token scope/expiry/replay, fixed tasks, quotas, consent, duplicate signups and repeatable migration. No live database was changed. Local tests do not prove live Gemini/Supabase integration. `/api/status` checks key presence, not account/model access. Run setup SQL and verify a real anonymous/sample plan before claiming completion.

Your coursework Step 4 prescribes GEMINI_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel. This user-requested one-key redesign deliberately differs from that prescribed architecture; do not claim those other variables are used or configured in the worksheet.

## Local use

Node 22+, no external packages required. Copy `.env.example` to `.env.local`, enter only your Gemini key privately, then `npm run dev`. Run `npm test`. Never commit `.env.local`.
