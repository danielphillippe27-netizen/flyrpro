import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { BedrockCountryService, BEDROCK_US_CONFIG } from '../services/BedrockCountryService';
import { normalizePmtilesAddressFeature } from '../../app/api/campaigns/_utils/scoped-pmtiles-addresses';
import { addressSourcePoint } from '../../app/api/campaigns/_utils/address-source-point';
import { resolveAddressNativeZooms } from '../../app/api/campaigns/_utils/address-native-zooms';
import { encodeCampaignAddressOverview } from '../../app/api/campaigns/_utils/campaign-address-overview-tile';

async function main() {
  process.env.BEDROCK_US_ADDRESS_PREFIX = 'bedrock/usa/20261010-netsyms202605/addresses';
  process.env.BEDROCK_US_ADDRESS_SOURCE = 'Netsyms Address Database 2026-05';
  process.env.DIAMOND_GEOMETRY_CDN_BASE_URL = 'https://tiles.example.test';
  const snapshot = await new BedrockCountryService(BEDROCK_US_CONFIG).staticSnapshotForCampaign('fixture', 'NY');
  assert.equal(snapshot.s3_keys.addresses, 'bedrock/usa/20261010-netsyms202605/addresses/pmtiles_by_state/state=NY/addresses.pmtiles');
  assert.equal(snapshot.s3_keys.buildings, 'bedrock/usa/current/buildings/pmtiles_by_state/state=NY/buildings.pmtiles');
  const metrics = snapshot.metadata?.tile_metrics as unknown as {sources:{addresses:string}};
  assert.equal(metrics.sources.addresses, 'Netsyms Address Database 2026-05');
  assert.deepEqual(addressSourcePoint({longitude:-73.828125,latitude:40.713},[-73.82,40.71]),[-73.828125,40.713]);
  assert.deepEqual(addressSourcePoint({longitude:40000,latitude:715},[-73.82,40.71]),[-73.82,40.71]);
  const path = process.argv[2];
  assert.ok(path, 'Pass the fixture archive path');
  const fd = fs.openSync(path, 'r');
  try {
    const archive = new PMTiles({
      getKey: () => path,
      getBytes: async (offset, length) => {
        const b = Buffer.alloc(length);
        fs.readSync(fd,b,0,length,offset);
        return {data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
      },
    });
    const native = await resolveAddressNativeZooms({ ...snapshot, buildings_count:0, created_at:'2026-10-10', tile_metrics:{address_maxzoom:18}, buildings_key:snapshot.s3_keys.buildings,addresses_key:snapshot.s3_keys.addresses, buildings_url:null,metadata_key:null }, snapshot.s3_keys.addresses!, () => archive.getHeader());
    assert.deepEqual(native,{minzoom:10,maxzoom:16});
    let expectedIds: string[] | null = null;
    for (let z=10;z<=16;z++) {
      const n=2**z,lon=-73.828125,lat=40.713;
      const x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
      const addresses = new Map();
      for (const tileX of [x-1,x]) {
        const tile = await archive.getZxy(z,tileX,y);
        if (!tile) continue;
        const layer = new VectorTile(new Pbf(new Uint8Array(tile.data))).layers.addresses;
        for (let i=0;i<layer.length;i++) {
          const feature = layer.feature(i).toGeoJSON(tileX,y,z);
          const exact = addressSourcePoint(feature.properties, (feature.geometry as GeoJSON.Point).coordinates as [number,number]);
          const address=normalizePmtilesAddressFeature({campaignId:'fixture',feature,lon:exact[0],lat:exact[1],source:'bedrock_us'});
          addresses.set(feature.properties!.address_id,address);
        }
      }
      assert.equal(addresses.size,3,`Every unique address survives z${z}`);
      const ids=Array.from(addresses.keys()).sort();
      if(expectedIds)assert.deepEqual(ids,expectedIds);else expectedIds=ids;
      assert.deepEqual(Array.from(addresses.values()).map(a=>a.unit).filter(Boolean).sort(),['APT 1','APT 2']);
      for(const a of addresses.values())assert.equal(a.lat,40.713,'Source coordinates remain exact');
      const rows=Array.from(addresses.values()).map((a,i)=>({id:`campaign-stop-${i}`,gers_id:a.gers_id,source_id:null,house_number:a.house_number,formatted:a.formatted,coordinate:a.coordinate}));
      const renderTile=encodeCampaignAddressOverview(rows,{z,x,y});
      const renderLayer=new VectorTile(new Pbf(renderTile)).layers.addresses;
      assert.equal(renderLayer.length,3,`Campaign tiles retain all stops at z${z}`);
      const campaignIds=[];
      for(let i=0;i<renderLayer.length;i++) {
        const props=renderLayer.feature(i).properties;
        campaignIds.push(props.address_id);
        assert.ok(String(props.source_id).startsWith('netsyms:us:'));
        assert.equal(props.latitude,40.713);
      }
      assert.deepEqual(campaignIds.sort(),['campaign-stop-0','campaign-stop-1','campaign-stop-2'],'Rendered feature IDs match selection, notes, and door-state IDs');
    }
    console.log('PASS: immutable US address prefix, unchanged building source, native overzoom range, exact seam coordinates, unit identity, and all addresses at z10–16');
  } finally {fs.closeSync(fd);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
