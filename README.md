# BCV API Worker

Proxy API that fetches the USD rate from https://www.bcv.org.ve/ and caches it for 2 hours.

## Auth model

Requests must include:

- `x-device-id`
- `x-api-key`

The worker allows only device ids configured in `ALLOWED_DEVICES` (JSON map of `device_id -> api_key`).

## Config

Set these env vars:

- `ALLOWED_DEVICES` (JSON map)
- `CACHE_TTL_SECONDS` (default 7200)
- `RATE_LIMIT_WINDOW_MS` (default 60000)
- `RATE_LIMIT_MAX` (default 60)
- `BCV_URL` (optional, defaults to https://www.bcv.org.ve/)

## Endpoints

- `GET /` or `GET /rate` (requires `x-device-id` + `x-api-key`)

Returns JSON (only `current`):

```json
{
  "current": {
    "usd": 361.4906,
    "eur": null,
    "date": "2026-01-28"
  }
}
```
