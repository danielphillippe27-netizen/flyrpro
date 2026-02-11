# CVRP Lambda (Route optimization)

Optimizes walking routes for FLYR-PRO using OR-Tools (CVRP) and Stadia/Valhalla for the distance matrix.

## Auth (fixing "unauthorized")

The app sends `CVRP_LAMBDA_SECRET` in the `x-cvrp-secret` header. The Lambda checks this when `CVRP_LAMBDA_SECRET` is set in its environment.

1. **Function URL auth must be NONE**  
   If the Function URL uses **AWS_IAM**, AWS rejects requests before your code runs. In Lambda console: **Configuration → Function URL → Edit → Auth type: NONE**.

2. **Set the same secret in the Lambda**  
   In Lambda **Configuration → Environment variables**, add or edit:
   - **CVRP_LAMBDA_SECRET** = same value as `CVRP_LAMBDA_SECRET` in your app’s `.env.local`  
   (e.g. the long base64 string you use locally.)

3. **Redeploy**  
   Deploy this template (e.g. `./deploy.sh`) so the Lambda runs the version that checks the header. Then retry “Optimize” from the app.

## Env vars (Lambda)

| Variable | Required | Description |
|----------|----------|-------------|
| `VALHALLA_API_KEY` | Yes | Stadia Maps API key (pedestrian matrix) |
| `VALHALLA_BASE_URL` | No | Default `https://api.stadiamaps.com` |
| `CVRP_LAMBDA_SECRET` | Yes in prod | Must match app `.env.local`; if unset, no auth (dev only) |
