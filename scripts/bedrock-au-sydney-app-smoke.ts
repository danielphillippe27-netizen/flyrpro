import { createClient } from '@supabase/supabase-js';

const apiBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3020';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required');
}

const smokeSize = process.env.BEDROCK_AU_SMOKE_SIZE === 'large' ? 'large' : 'small';
const smokeBounds = smokeSize === 'large'
  ? [151.16, -33.915, 151.255, -33.815]
  : [151.199, -33.8795, 151.214, -33.867];

const polygon: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [smokeBounds[0], smokeBounds[1]],
    [smokeBounds[2], smokeBounds[1]],
    [smokeBounds[2], smokeBounds[3]],
    [smokeBounds[0], smokeBounds[3]],
    [smokeBounds[0], smokeBounds[1]],
  ]],
};
const bbox = smokeBounds;

async function main() {
  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const auth = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const email = `bedrock-au-sydney-smoke-${stamp}@example.com`;
  const password = `BedrockSydney${stamp}!`;
  const campaignName = `BEDROCK AU Sydney Smoke ${stamp}`;

  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError || !created.user) {
    throw new Error(`createUser failed: ${createUserError?.message ?? 'missing user'}`);
  }

  const userId = created.user.id;
  const { data: sessionData, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError || !sessionData.session?.access_token) {
    throw new Error(`signIn failed: ${signInError?.message ?? 'missing access token'}`);
  }

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .insert({
      name: `BEDROCK AU Smoke ${stamp}`,
      owner_id: userId,
    })
    .select('id')
    .single();
  if (workspaceError || !workspace) {
    throw new Error(`workspace insert failed: ${workspaceError?.message ?? 'missing workspace'}`);
  }

  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner',
    });
  if (memberError) {
    throw new Error(`workspace membership insert failed: ${memberError.message}`);
  }

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .insert({
      owner_id: userId,
      workspace_id: workspace.id,
      name: campaignName,
      title: campaignName,
      description: 'Automated BEDROCK Australia Sydney provisioning smoke test',
      type: 'flyer',
      address_source: 'map',
      region: null,
      seed_query: 'Sydney CBD',
      bbox,
      territory_boundary: polygon,
      total_flyers: 0,
      scans: 0,
      conversions: 0,
      status: 'draft',
    })
    .select('id')
    .single();
  if (campaignError || !campaign) {
    throw new Error(`campaign insert failed: ${campaignError?.message ?? 'missing campaign'}`);
  }

  const provisionResponse = await fetch(`${apiBaseUrl}/api/campaigns/provision`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ campaign_id: campaign.id }),
  });
  const provisionBody = await provisionResponse.json().catch(() => ({}));
  if (!provisionResponse.ok) {
    throw new Error(`provision failed ${provisionResponse.status}: ${JSON.stringify(provisionBody)}`);
  }

  const manifestResponse = await fetch(`${apiBaseUrl}/api/campaigns/${campaign.id}/diamond-manifest`, {
    headers: {
      authorization: `Bearer ${sessionData.session.access_token}`,
    },
  });
  const manifest = await manifestResponse.json().catch(() => ({}));
  if (!manifestResponse.ok) {
    throw new Error(`manifest failed ${manifestResponse.status}: ${JSON.stringify(manifest)}`);
  }

  const [{ count: addressCount }, { data: updatedCampaign }, { data: snapshot }] = await Promise.all([
    admin.from('campaign_addresses').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id),
    admin
      .from('campaigns')
      .select('id, region, provision_status, provision_phase, provision_source, map_mode')
      .eq('id', campaign.id)
      .single(),
    admin
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, addresses_key, buildings_count, addresses_count, tile_metrics')
      .eq('campaign_id', campaign.id)
      .single(),
  ]);

  console.log(JSON.stringify({
    smoke_size: smokeSize,
    bbox,
    campaign_id: campaign.id,
    test_user_id: userId,
    workspace_id: workspace.id,
    provision_response: provisionBody,
    provision_status: updatedCampaign?.provision_status,
    provision_phase: updatedCampaign?.provision_phase,
    provision_source: updatedCampaign?.provision_source,
    inferred_region: updatedCampaign?.region,
    address_count: addressCount,
    snapshot: {
      bucket: snapshot?.bucket,
      prefix: snapshot?.prefix,
      buildings_key: snapshot?.buildings_key,
      addresses_key: snapshot?.addresses_key,
      addresses_count: snapshot?.addresses_count,
      bedrock_country: snapshot?.tile_metrics?.bedrock_country,
      geometry_provider: snapshot?.tile_metrics?.geometry_provider,
      parquet_prefix: snapshot?.tile_metrics?.addresses_parquet_prefix,
    },
    manifest: {
      geometry_provider: manifest.geometry_provider,
      diamond_mode: manifest.diamond_mode,
      address_pmtiles_key: manifest.address_pmtiles_key,
      address_source_layer: manifest.address_source_layer,
      address_vector_tile_url_template: Boolean(manifest.address_vector_tile_url_template),
      address_pmtiles_url: Boolean(manifest.address_pmtiles_url),
      primary_state_layer: manifest.primary_state_layer,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
