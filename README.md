# Kestrel Bank backend (demo)

## Run it
1. Install Node 18+.
2. `npm install`
3. Copy `.env.example` to `.env` and fill it in.
4. `npm start`

## Email (Resend)
1. Sign up at resend.com, create an API key, put it in `RESEND_API_KEY`.
2. Verify your domain in Resend; set `MAIL_FROM` to an address on it.

## Deploy
Use Render, Railway, or Fly.io (Node service, keep a persistent disk for `bank.db`).
Set the same variables from `.env` in the host's dashboard.

## Connect the page
Replace the in-memory logic in the page with calls like:

    const r = await fetch(API + "/api/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ amount: 50, note: "Top up" })
    });

Set `ALLOWED_ORIGIN` to your site's address.

## Before real money
Remove `/api/credit`; use a licensed payment provider, KYC, HTTPS, audit logs, and legal/regulatory approval.
