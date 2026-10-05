# KimiCoco contact integration

Setup, mapping rules, migration requirements, and local verification are documented in the KimiCoco checkout at `docs/wolfgrid-integration.md`.

Apply `supabase/migrations/20261005120000_kimicoco_integration.sql` to the WolfGrid database and KimiCoco's `202610050001_wolfgrid.sql` to its separate database, then deploy both apps. The WolfGrid job worker uses the existing `CRON_SECRET` and CRM encryption key. Its receiver URL defaults to `https://kimicoco.vercel.app`; override with the server-only `KIMICOCO_API_URL` for another trusted deployment.

Create a workspace connection key in KimiCoco → Integrations → WolfGrid, then connect KimiCoco in WolfGrid's web or mobile integrations screen. Saved `contacts` rows queue automatically; records held only in `field_leads` must first be saved as contacts. Automatic delivery runs after web responses and via the durable minute-by-minute cron worker. Mobile push routes also preserve explicitly selected appointments and follow-up tasks.

Web settings support automatic sync, selected-contact batches, queue status, retries, and links to imported KimiCoco contacts. Native APIs follow the existing `/api/integrations/kimicoco/{connect,disconnect,status,test,push-lead,test-push}` pattern; Android and iOS use the provider catalog. KimiCoco keys remain server-side after connecting.

Local verification is separate from live deployment and device testing. From the sibling KimiCoco checkout run `pnpm --filter @kimicoco/web test:wolfgrid` for the real migrations, receiver, payload mapper, and durable queue tests.
