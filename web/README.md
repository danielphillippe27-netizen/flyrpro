# FLYR Leaderboard (Web)

React + Vite app that shows the global leaderboard using the same Supabase RPC as the iOS app.

## Setup

1. Copy env example and set your Supabase credentials:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `VITE_SUPABASE_URL` – your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` – your project’s anon (public) key

2. Install and run:
   ```bash
   npm install
   npm run dev
   ```
   Open the dev server URL (e.g. http://localhost:5173).

## Build

```bash
npm run build
```
Output is in `web/dist/`.

## Routes

- `/` and `/leaderboard` both render the leaderboard page.
