# Daily Quote on iOS

The web app shows a “Quote of the Day” on the home dashboard. The same content is available to iOS via a single API call.

## API

**GET** `{BASE_URL}/api/daily-content`

- **Auth:** If your app sends a session (e.g. Bearer token or cookies) for other API calls, use the same for this request. The route does not enforce auth itself; if you have middleware that requires auth for `/api/*`, include the user’s session.
- **Response (200):** JSON

```json
{
  "success": true,
  "quote": {
    "text": "The only impossible journey is the one you never begin.",
    "author": "Tony Robbins",
    "category": "motivational"
  },
  "riddle": {
    "question": "I have cities, but no houses...",
    "answer": "A map",
    "difficulty": "easy"
  },
  "cached_at": "2025-02-19T...",
  "expires_at": "2025-02-20T..."
}
```

- **Quote only:** You can ignore `riddle` and use only `quote.text` and `quote.author`.
- **Errors:** On failure the API still returns `200` with `success: true` and a fallback quote, so you always get a quote.

## Backend behavior

- Content is cached per calendar day in `daily_content_cache` (quote + optional riddle).
- Quote is fetched from an external API when cache is missing/expired, then stored; fallback is a fixed list of quotes by day of year.
- Same URL returns the same quote for the day for all clients (web and iOS).

## iOS implementation outline

1. **Request:** `GET {yourApiBase}/api/daily-content` with the same auth your app uses for other APIs (if any).
2. **Parse:** Decode `quote.text` and `quote.author` (and optionally `quote.category`).
3. **UI:** Show a card or section with the quote and “— {author}” (e.g. match web’s “Quote of the Day” style).

No new backend work is required; the existing route is sufficient for iOS.
