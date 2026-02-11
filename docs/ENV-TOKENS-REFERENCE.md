# Environment Tokens & Secrets Reference

**Last updated:** Feb 10, 2026  
**New / required in last 4 days** are marked with **(new)**.

---

## New in last 4 days (from recent commit)

These are now **required** or explicitly checked by the app:

| Variable | Where to get it | Used by |
|----------|-----------------|--------|
| **SLICE_LAMBDA_URL** **(new)** | `aws lambda get-function-url-config --function-name flyr-slice` (or your slice Lambda name) | Address generation, campaign provisioning |
| **SLICE_SHARED_SECRET** **(new)** | Generated when deploying the slice Lambda (kimi-cli deploy); must match Lambda env `SLICE_SHARED_SECRET` | Same; auth header `x-slice-secret` |
| **SUPABASE_SERVICE_ROLE_KEY** **(new)** | Supabase Dashboard → Project Settings → API → `service_role` (secret) | Admin client, generate-address-list, server auth |

---

## All tokens / secrets used by the site

### Supabase
| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → API → service_role (secret) |

### Mapbox
| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | mapbox.com → Account → Access tokens (public, pk.*) |
| `MAPBOX_TOKEN` | Same; used server-side for geocoding |

### CVRP routing Lambda
| Variable | Where to get it |
|----------|-----------------|
| `CVRP_LAMBDA_URL` | AWS API Gateway URL for your CVRP/optimize Lambda |
| `CVRP_LAMBDA_SECRET` | Value you set in Lambda env; app sends it as `x-flyr-secret` / `x-cvrp-secret` |

### Slice / address Lambda (Gold Standard)
| Variable | Where to get it |
|----------|-----------------|
| `SLICE_LAMBDA_URL` | Lambda function URL for flyr-slice (or your slice function) |
| `SLICE_SHARED_SECRET` | Must match `SLICE_SHARED_SECRET` in Lambda env (from kimi-cli deploy) |

### Stadia Maps (Valhalla routing)
| Variable | Where to get it |
|----------|-----------------|
| `STADIA_API_KEY` | stadiamaps.com → API key |

### AWS (S3 / legacy)
| Variable | Where to get it |
|----------|-----------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | e.g. `us-east-2` |
| `FLYR_ADDRESSES_S3_BUCKET` | Your S3 bucket name |
| `FLYR_ADDRESSES_S3_REGION` | Bucket region |

### CRM / integrations
| Variable | Where to get it |
|----------|-----------------|
| `ENCRYPTION_KEY` | 32-character key for encrypting CRM API keys in DB (e.g. `openssl rand -base64 32 \| cut -c1-32`) |

### Optional / other
| Variable | Where to get it |
|----------|-----------------|
| `GEMINI_API_KEY` | Google AI Studio |
| `BG_REMOVER_API_KEY` | remove.bg or similar |
| `MOTHERDUCK_TOKEN` | MotherDuck dashboard (optional; scripts / fallback) |
| `NEXT_PUBLIC_APP_URL` | Your app URL (e.g. https://flyrpro.vercel.app) |
| `NEXT_PUBLIC_PMTILES_URL` | Optional PMTiles URL for map layers |

---

## Web app (`web/`) – Vite

| Variable | Where to get it |
|----------|-----------------|
| `VITE_SUPABASE_URL` | Same as Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Same as anon key |

---

**Security:** Never commit `.env.local` or paste real secret values into docs or chat. Set these in Vercel (or your host) for production.
