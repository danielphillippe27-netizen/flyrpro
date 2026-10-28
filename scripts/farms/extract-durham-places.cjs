#!/usr/bin/env node
// Build a Durham-only Overture Places snapshot for farm commercial review.
const { DuckDBInstance } = require('@duckdb/node-api');
const turf = require('@turf/turf');
const fs = require('node:fs');
const path = require('node:path');
const RELEASE = '2026-10-21.0';
const BOUNDARY_URL = 'https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/2/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';
const output = process.argv[2];
if (!output) throw new Error('Provide an output directory');
(async () => {
  fs.mkdirSync(output, {recursive:true});
  const response = await fetch(BOUNDARY_URL);
  if (!response.ok) throw new Error(`Boundary download failed: ${response.status}`);
  const boundary = await response.json();
  if (boundary.type !== 'FeatureCollection' || boundary.features.length !== 1 || !['Polygon','MultiPolygon'].includes(boundary.features[0].geometry.type)) throw new Error('Unexpected Durham boundary');
  const [west,south,east,north] = turf.bbox(boundary);
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=4");
  const source = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*`;
  const tmp = path.resolve(output,'candidates.ndjson').replace(/'/g,"''");
  await conn.run(`COPY (SELECT id, names, addresses, basic_category, taxonomy, confidence, operating_status, sources, bbox.xmin AS lon, bbox.ymin AS lat FROM read_parquet('${source}', hive_partitioning=1) WHERE bbox.xmin BETWEEN ${west} AND ${east} AND bbox.ymin BETWEEN ${south} AND ${north}) TO '${tmp}' (FORMAT JSON, ARRAY false)`);
  const candidates = fs.readFileSync(tmp,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const places = candidates.filter(p => turf.booleanPointInPolygon([p.lon,p.lat],boundary.features[0]));
  fs.writeFileSync(path.join(output,'places.json'),JSON.stringify({release:RELEASE,places}));
  fs.writeFileSync(path.join(output,'boundary.geojson'),JSON.stringify(boundary));
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({release:RELEASE,count:places.length,bbox:[west,south,east,north],source,boundarySource:BOUNDARY_URL,generatedAt:new Date().toISOString(), attribution:'Overture Maps Foundation; Region of Durham Open Data',scope:'Durham Region, Ontario',purpose:'Farm commercial review; business records alone do not establish residential use'},null,2));
  fs.unlinkSync(tmp);
  console.log(JSON.stringify({count:places.length,candidates:candidates.length,bbox:[west,south,east,north]}));
})().catch(e=>{console.error(e);process.exitCode=1});
