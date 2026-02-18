#!/usr/bin/env tsx
/**
 * Gold Tier Ingest Script (The "Claw")
 * 
 * Fetches authoritative municipal data from Esri ArcGIS servers,
 * filters out noise (sheds < 35sqm), and uploads clean GeoJSON to S3.
 * 
 * Usage:
 *   npx tsx scripts/ingest_municipal_data.ts --source=durham_addr [--dry-run]
 *   npx tsx scripts/ingest_municipal_data.ts --all
 *   npx tsx scripts/ingest_municipal_data.ts --group=durham_york_peel
 * 
 * Sources are defined in MUNICIPAL_SOURCES array below.
 */

import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseArgs } from 'util';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ============================================================================
// ADDRESS SOURCES - Top 50 Canadian Municipal Address Datasets
// ============================================================================

const ADDRESS_SOURCES = [
  // --- 1. ONTARIO: DURHAM & EAST (Home Turf) ---
  {
    id: 'durham_addr',
    name: 'Region of Durham',
    url: 'https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/0',
    s3Key: 'gold-standard/canada/ontario/durham/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'CIVIC_NUM', streetName: 'ROAD_NAME', unit: 'UNIT_NUM', city: 'MUNICIPALITY' }
  },
  {
    id: 'peterborough_addr',
    name: 'City of Peterborough',
    url: 'https://services1.arcgis.com/pMeNd6LYN9KSmw0t/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/peterborough/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'st_no', streetName: 'st_name', unit: 'unit', city: 'muni' }
  },
  {
    id: 'northumberland_addr',
    name: 'Northumberland County',
    url: 'https://services1.arcgis.com/02RoI8WqS4Kj8mX9/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/northumberland/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'CIVIC_NUM', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  },
  {
    id: 'kawartha_addr',
    name: 'City of Kawartha Lakes',
    url: 'https://services5.arcgis.com/ButL5iM7pE0zZ7kL/arcgis/rest/services/Civic_Address/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/kawartha/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'CIVIC_NUM', streetName: 'FULL_STREE', unit: 'UNIT_NUM', city: 'COMMUNITY' }
  },
  // Ottawa URLs need verification
  // {
  //   id: 'ottawa_addr',
  //   name: 'City of Ottawa',
  //   url: 'https://maps.ottawa.ca/arcgis/rest/services/Property_Parcels/Address_Points/FeatureServer/0',
  //   s3Key: 'gold-standard/canada/ontario/ottawa/addresses.geojson',
  //   type: 'address' as const,
  //   province: 'ON',
  //   fieldMap: { streetNumber: 'ADDR_NUM', streetName: 'ROAD_NAME', unit: 'ADDR_UNIT', city: 'MUNICIPALITY' }
  // },
  {
    id: 'kingston_addr',
    name: 'City of Kingston',
    url: 'https://services1.arcgis.com/pMeNd6LYN9KSmw0t/arcgis/rest/services/Kingston_Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/kingston/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'STREET_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  },

  // --- 2. ONTARIO: GTA CORE (Density) ---
  // City of Toronto (ArcGIS): Address Points from cot_geospatial27 Layer 101.
  // If 404, check https://gis.toronto.ca/arcgis/rest/services/?f=json for current version (e.g. cot_geospatial28).
  {
    id: 'toronto_addresses',
    name: 'City of Toronto Addresses (ArcGIS)',
    url: 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial27/FeatureServer/101',
    s3Key: 'gold-standard/canada/ontario/toronto/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    city: 'Toronto',
    fieldMap: {
      streetNumber: 'ADDRESS_NUMBER',
      streetNumberSuffix: 'LO_NUM_SUF',
      streetName: 'LINEAR_NAME',
      streetNameFull: 'LINEAR_NAME_FULL',
      streetType: 'LINEAR_NAME_TYPE',
      streetDir: 'LINEAR_NAME_DIR',
      city: 'MUNICIPALITY_NAME',
    }
  },
  // City of Toronto (CKAN): Same dataset via Toronto Open Data API. Package: address-points-municipal-toronto-one-address-repository
  // https://ckan0.cf.opendata.inter.prod-toronto.ca – same schema (ADDRESS_NUMBER, LINEAR_NAME_FULL, geometry in datastore).
  {
    id: 'toronto_addresses_ckan',
    name: 'City of Toronto Addresses (CKAN)',
    url: 'https://ckan0.cf.opendata.inter.prod-toronto.ca',
    s3Key: 'gold-standard/canada/ontario/toronto/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    city: 'Toronto',
    api: 'ckan' as const,
    ckanBaseUrl: 'https://ckan0.cf.opendata.inter.prod-toronto.ca',
    ckanResourceId: '0b3756af-9caf-4f0f-ac28-9c6617adede4',
    fieldMap: {
      streetNumber: 'ADDRESS_NUMBER',
      streetNumberSuffix: 'LO_NUM_SUF',
      streetName: 'LINEAR_NAME',
      streetNameFull: 'LINEAR_NAME_FULL',
      streetType: 'LINEAR_NAME_TYPE',
      streetDir: 'LINEAR_NAME_DIR',
      city: 'MUNICIPALITY_NAME',
    }
  },
  // York URLs currently unavailable
  // {
  //   id: 'york_addr',
  //   name: 'Region of York (Markham/Vaughan)',
  //   url: 'https://gis.york.ca/arcgis/rest/services/YRC_AddressPoints/FeatureServer/0',
  //   s3Key: 'gold-standard/canada/ontario/york/addresses.geojson',
  //   type: 'address' as const,
  //   province: 'ON',
  //   fieldMap: { streetNumber: 'NUM', streetName: 'STREET', unit: 'UNIT', city: 'MUNICIPALITY' }
  // },
  // Peel URLs currently unavailable
  // {
  //   id: 'peel_addr',
  //   name: 'Region of Peel (Mississauga/Brampton)',
  //   url: 'https://services6.arcgis.com/2KCAhidn20a22bHj/arcgis/rest/services/Address_Points/FeatureServer/0',
  //   s3Key: 'gold-standard/canada/ontario/peel/addresses.geojson',
  //   type: 'address' as const,
  //   province: 'ON',
  //   fieldMap: { streetNumber: 'ADD_NUM', streetName: 'ST_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  // },
  {
    id: 'halton_addr',
    name: 'Region of Halton (Oakville/Burlington)',
    url: 'https://services6.arcgis.com/h2G2s2j7p5r830eR/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/halton/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'STREET_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY_NAME' }
  },

  // --- 3. ONTARIO: GOLDEN HORSESHOE & WEST ---
  {
    id: 'hamilton_addr',
    name: 'City of Hamilton',
    url: 'https://spatialsolutions.hamilton.ca/arcgis/rest/services/Hamilton_Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/hamilton/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'STREET_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'COMMUNITY' }
  },
  {
    id: 'niagara_addr',
    name: 'Niagara Region',
    url: 'https://services-niagararegion.arcgis.com/s6M3rJ73j889q48y/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/niagara/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'CIVIC_NUM', streetName: 'STREET_NAME', unit: 'UNIT_NUM', city: 'MUNICIPALITY' }
  },
  {
    id: 'waterloo_addr',
    name: 'Region of Waterloo',
    url: 'https://services1.arcgis.com/qNxRi4jJ9n9C9rXh/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/waterloo/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'HOUSE_NUM_RANGE', streetName: 'STREET', unit: 'UNIT', city: 'MUNICIPALITY' }
  },
  {
    id: 'guelph_addr',
    name: 'City of Guelph',
    url: 'https://services1.arcgis.com/8N69F6q3o9c8gA4N/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/guelph/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'street_number', streetName: 'street_name', unit: 'unit', city: 'municipality' }
  },
  {
    id: 'london_addr',
    name: 'City of London',
    url: 'https://services.arcgis.com/lD2H4aU2f9Wf1w0q/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/london/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'ADDRESS_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  },
  {
    id: 'windsor_addr',
    name: 'City of Windsor',
    url: 'https://gis.citywindsor.ca/arcgis/rest/services/OpenData/Windsor_Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/windsor/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'ADDRESS_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  },
  {
    id: 'barrie_addr',
    name: 'City of Barrie',
    url: 'https://services.arcgis.com/K12pp94r2f628P3S/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/barrie/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'STREET_NUM', streetName: 'STREET_NAME', unit: 'UNIT_NUM', city: 'MUNICIPALITY' }
  },
  {
    id: 'brantford_addr',
    name: 'City of Brantford',
    url: 'https://services-brantford.arcgis.com/Fdbwz4w78Q5h5J7T/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/brantford/addresses.geojson',
    type: 'address' as const,
    province: 'ON',
    fieldMap: { streetNumber: 'STREET_NUM', streetName: 'STREET_NAME', unit: 'UNIT', city: 'MUNICIPALITY' }
  },

  // --- 4. BRITISH COLUMBIA (Crucial Density) ---
  {
    id: 'vancouver_addr',
    name: 'City of Vancouver',
    url: 'https://maps.vancouver.ca/server/rest/services/OpenData/Property_Address_Points_View/MapServer/0',
    s3Key: 'gold-standard/canada/bc/vancouver/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'CivicNumber', streetName: 'StdStreetName', unit: 'UnitNumber', city: 'Jurisdiction' }
  },
  {
    id: 'surrey_addr',
    name: 'City of Surrey',
    url: 'https://cosmos.surrey.ca/arcgis/rest/services/OpenData/Cosmos_OpenData/MapServer/6',
    s3Key: 'gold-standard/canada/bc/surrey/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'CIVIC_NUMBER', streetName: 'STREET_NAME', unit: 'SUITE_NUMBER', city: 'CITY' }
  },
  {
    id: 'burnaby_addr',
    name: 'City of Burnaby',
    url: 'https://gis.burnaby.ca/arcgis/rest/services/OpenData/OpenData_Address/MapServer/0',
    s3Key: 'gold-standard/canada/bc/burnaby/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'STREET_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT', city: 'CITY' }
  },
  {
    id: 'richmond_addr',
    name: 'City of Richmond',
    url: 'https://maps.richmond.ca/arcgis/rest/services/OpenData/AddressPoints/MapServer/0',
    s3Key: 'gold-standard/canada/bc/richmond/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'House', streetName: 'Street', unit: 'Unit', city: 'City' }
  },
  {
    id: 'victoria_addr',
    name: 'City of Victoria',
    url: 'https://mapservices.victoria.ca/arcgis/rest/services/OpenData/Address_Points/MapServer/0',
    s3Key: 'gold-standard/canada/bc/victoria/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'CivicNumber', streetName: 'StreetName', unit: 'UnitNumber', city: 'City' }
  },
  {
    id: 'kelowna_addr',
    name: 'City of Kelowna',
    url: 'https://services1.arcgis.com/5L929bF3A0x6d9N3/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/bc/kelowna/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'civic_number', streetName: 'street_name', unit: 'unit', city: 'municipality' }
  },
  {
    id: 'kamloops_addr',
    name: 'City of Kamloops',
    url: 'https://services1.arcgis.com/c9R964rG4y05JjD9/arcgis/rest/services/AddressPoints/FeatureServer/0',
    s3Key: 'gold-standard/canada/bc/kamloops/addresses.geojson',
    type: 'address' as const,
    province: 'BC',
    fieldMap: { streetNumber: 'StreetNumber', streetName: 'StreetName', unit: 'Unit', city: 'City' }
  },

  // --- 5. ALBERTA & PRAIRIES ---
  {
    id: 'calgary_addr',
    name: 'City of Calgary',
    url: 'https://gis.calgary.ca/arcgis/rest/services/pub_OpenData/OD_Address/FeatureServer/0',
    s3Key: 'gold-standard/canada/alberta/calgary/addresses.geojson',
    type: 'address' as const,
    province: 'AB',
    fieldMap: { streetNumber: 'ADDRESS_NUMBER', streetName: 'STREET_NAME', unit: 'UNIT_CODE', city: 'COMMUNITY' }
  },
  {
    id: 'edmonton_addr',
    name: 'City of Edmonton',
    url: 'https://gis.edmonton.ca/arcgis/rest/services/OpenData/Comparison/FeatureServer/0',
    s3Key: 'gold-standard/canada/alberta/edmonton/addresses.geojson',
    type: 'address' as const,
    province: 'AB',
    fieldMap: { streetNumber: 'HOUSE_NUMBER', streetName: 'STREET_NAME', unit: 'SUITE', city: 'NEIGHBOURHOOD' }
  },
  {
    id: 'reddeer_addr',
    name: 'City of Red Deer',
    url: 'https://services6.arcgis.com/mO9z7lZtE6o7Yx5X/arcgis/rest/services/Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/alberta/reddeer/addresses.geojson',
    type: 'address' as const,
    province: 'AB',
    fieldMap: { streetNumber: 'CIVIC_NO', streetName: 'STREET', unit: 'UNIT', city: 'MUNICIPALITY' }
  },
  {
    id: 'saskatoon_addr',
    name: 'City of Saskatoon',
    url: 'https://map.saskatoon.ca/arcgis/rest/services/OpenData/Address_Points/MapServer/0',
    s3Key: 'gold-standard/canada/saskatchewan/saskatoon/addresses.geojson',
    type: 'address' as const,
    province: 'SK',
    fieldMap: { streetNumber: 'Civic_Number', streetName: 'Street_Name', unit: 'Unit', city: 'City' }
  },
  {
    id: 'winnipeg_addr',
    name: 'City of Winnipeg',
    url: 'https://services6.arcgis.com/2KCAhidn20a22bHj/arcgis/rest/services/Winnipeg_Address_Points/FeatureServer/0',
    s3Key: 'gold-standard/canada/manitoba/winnipeg/addresses.geojson',
    type: 'address' as const,
    province: 'MB',
    fieldMap: { streetNumber: 'StreetNumber', streetName: 'StreetName', unit: 'Unit', city: 'Municipality' }
  },

  // --- 6. ATLANTIC CANADA ---
  {
    id: 'halifax_addr',
    name: 'Halifax (HRM)',
    url: 'https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/CivicAddresses/FeatureServer/0',
    s3Key: 'gold-standard/canada/nova-scotia/halifax/addresses.geojson',
    type: 'address' as const,
    province: 'NS',
    fieldMap: { streetNumber: 'CIVIC_NUM', streetName: 'STREET', unit: 'UNIT', city: 'COMMUNITY' }
  },
  // St. John's URL needs verification - placeholder for now
  // {
  //   id: 'stjohns_addr',
  //   name: 'City of St. Johns',
  //   url: 'https://map.stjohns.ca/arcgis/rest/services/OpenData/Address_Points/MapServer/0',
  //   s3Key: 'gold-standard/canada/newfoundland/st-johns/addresses.geojson',
  //   type: 'address' as const,
  //   province: 'NL',
  //   fieldMap: { streetNumber: 'STREET_NUM', streetName: 'STREET', unit: 'UNIT', city: 'COMMUNITY' }
  // }
];

// ============================================================================
// BUILDING SOURCES - Top 25 Canadian Building Footprint Datasets
// ============================================================================

const BUILDING_SOURCES = [
  // --- ONTARIO (Highest Quality) ---
  {
    id: 'durham_bldg',
    name: 'Region of Durham',
    url: 'https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/25',
    s3Key: 'gold-standard/canada/ontario/durham/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'peterborough_bldg',
    name: 'City of Peterborough',
    url: 'https://services1.arcgis.com/pMeNd6LYN9KSmw0t/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/peterborough/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'northumberland_bldg',
    name: 'Northumberland County',
    url: 'https://services1.arcgis.com/02RoI8WqS4Kj8mX9/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/northumberland/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  // Toronto buildings URL needs verification
  // {
  //   id: 'toronto_bldg',
  //   name: 'City of Toronto',
  //   url: 'https://gis.toronto.ca/arcgis/rest/services/primary/COT_BUILDING_FOOTPRINT/MapServer/0',
  //   s3Key: 'gold-standard/canada/ontario/toronto/buildings.geojson',
  //   type: 'building' as const,
  //   province: 'ON',
  //   filters: { minArea: 35 }
  // },
  // {
  //   id: 'york_bldg',
  //   name: 'Region of York',
  //   url: 'https://gis.york.ca/arcgis/rest/services/YRC_BuildingFootprints/FeatureServer/0',
  //   s3Key: 'gold-standard/canada/ontario/york/buildings.geojson',
  //   type: 'building' as const,
  //   province: 'ON',
  //   filters: { minArea: 35 }
  // },
  // {
  //   id: 'peel_bldg',
  //   name: 'Region of Peel',
  //   url: 'https://services6.arcgis.com/2KCAhidn20a22bHj/arcgis/rest/services/Building_Footprints_2024/FeatureServer/0',
  //   s3Key: 'gold-standard/canada/ontario/peel/buildings.geojson',
  //   type: 'building' as const,
  //   province: 'ON',
  //   filters: { minArea: 35 }
  // },
  // {
  //   id: 'ottawa_bldg',
  //   name: 'City of Ottawa',
  //   url: 'https://maps.ottawa.ca/arcgis/rest/services/Building_Footprints/MapServer/0',
  //   s3Key: 'gold-standard/canada/ontario/ottawa/buildings.geojson',
  //   type: 'building' as const,
  //   province: 'ON',
  //   filters: { minArea: 35 }
  // },
  {
    id: 'waterloo_bldg',
    name: 'Region of Waterloo',
    url: 'https://services1.arcgis.com/qNxRi4jJ9n9C9rXh/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/waterloo/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'niagara_bldg',
    name: 'Niagara Region',
    url: 'https://services-niagararegion.arcgis.com/s6M3rJ73j889q48y/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/niagara/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'kingston_bldg',
    name: 'City of Kingston',
    url: 'https://services1.arcgis.com/pMeNd6LYN9KSmw0t/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/kingston/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'guelph_bldg',
    name: 'City of Guelph',
    url: 'https://services1.arcgis.com/8N69F6q3o9c8gA4N/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/guelph/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },
  {
    id: 'brantford_bldg',
    name: 'City of Brantford',
    url: 'https://services-brantford.arcgis.com/Fdbwz4w78Q5h5J7T/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/ontario/brantford/buildings.geojson',
    type: 'building' as const,
    province: 'ON',
    filters: { minArea: 35 }
  },

  // --- WESTERN CANADA (Excellent Quality) ---
  {
    id: 'calgary_bldg',
    name: 'City of Calgary',
    url: 'https://gis.calgary.ca/arcgis/rest/services/pub_OpenData/OD_BuildingFootprint/FeatureServer/0',
    s3Key: 'gold-standard/canada/alberta/calgary/buildings.geojson',
    type: 'building' as const,
    province: 'AB',
    filters: { minArea: 35 }
  },
  {
    id: 'edmonton_bldg',
    name: 'City of Edmonton',
    url: 'https://gis.edmonton.ca/arcgis/rest/services/OpenData/Infrastructure/FeatureServer/1',
    s3Key: 'gold-standard/canada/alberta/edmonton/buildings.geojson',
    type: 'building' as const,
    province: 'AB',
    filters: { minArea: 35 }
  },
  {
    id: 'reddeer_bldg',
    name: 'City of Red Deer',
    url: 'https://services6.arcgis.com/mO9z7lZtE6o7Yx5X/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/alberta/reddeer/buildings.geojson',
    type: 'building' as const,
    province: 'AB',
    filters: { minArea: 35 }
  },
  {
    id: 'vancouver_bldg',
    name: 'City of Vancouver',
    url: 'https://maps.vancouver.ca/server/rest/services/OpenData/Building_Footprints/MapServer/0',
    s3Key: 'gold-standard/canada/bc/vancouver/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'surrey_bldg',
    name: 'City of Surrey',
    url: 'https://cosmos.surrey.ca/arcgis/rest/services/OpenData/Cosmos_OpenData/MapServer/3',
    s3Key: 'gold-standard/canada/bc/surrey/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'burnaby_bldg',
    name: 'City of Burnaby',
    url: 'https://gis.burnaby.ca/arcgis/rest/services/OpenData/Building_Footprints/MapServer/0',
    s3Key: 'gold-standard/canada/bc/burnaby/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'richmond_bldg',
    name: 'City of Richmond',
    url: 'https://maps.richmond.ca/arcgis/rest/services/OpenData/BuildingFootprints/MapServer/0',
    s3Key: 'gold-standard/canada/bc/richmond/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'victoria_bldg',
    name: 'City of Victoria',
    url: 'https://mapservices.victoria.ca/arcgis/rest/services/OpenData/Building_Footprints/MapServer/0',
    s3Key: 'gold-standard/canada/bc/victoria/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'kelowna_bldg',
    name: 'City of Kelowna',
    url: 'https://services1.arcgis.com/5L929bF3A0x6d9N3/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/bc/kelowna/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'kamloops_bldg',
    name: 'City of Kamloops',
    url: 'https://services1.arcgis.com/c9R964rG4y05JjD9/arcgis/rest/services/BuildingFootprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/bc/kamloops/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'nanaimo_bldg',
    name: 'City of Nanaimo',
    url: 'https://services1.arcgis.com/G5385C7Jk5J962v9/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/bc/nanaimo/buildings.geojson',
    type: 'building' as const,
    province: 'BC',
    filters: { minArea: 35 }
  },
  {
    id: 'saskatoon_bldg',
    name: 'City of Saskatoon',
    url: 'https://map.saskatoon.ca/arcgis/rest/services/OpenData/Building_Footprints/MapServer/0',
    s3Key: 'gold-standard/canada/saskatchewan/saskatoon/buildings.geojson',
    type: 'building' as const,
    province: 'SK',
    filters: { minArea: 35 }
  },
  {
    id: 'winnipeg_bldg',
    name: 'City of Winnipeg',
    url: 'https://services6.arcgis.com/2KCAhidn20a22bHj/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    s3Key: 'gold-standard/canada/manitoba/winnipeg/buildings.geojson',
    type: 'building' as const,
    province: 'MB',
    filters: { minArea: 35 }
  }
];

// ============================================================================
// PARALLEL EXECUTION GROUPS - For GitHub Actions Matrix Strategy
// ============================================================================

const GROUPS: Record<string, string[]> = {
  'durham_york_peel': [
    'durham_addr', 'durham_bldg'
    // 'york_addr', 'york_bldg' - URLs currently unavailable
    // 'peel_addr', 'peel_bldg' - URLs currently unavailable
  ],
  'toronto_ottawa': [
    'toronto_addresses_ckan',  // Toronto via CKAN Open Data (same S3 key as toronto_addresses)
    'toronto_addresses'
    // 'toronto_bldg', - URL needs verification
    // 'ottawa_addr', 'ottawa_bldg' - URLs need verification
  ],
  'ontario_rest': [
    'peterborough_addr', 'peterborough_bldg',
    'northumberland_addr', 'northumberland_bldg',
    'kawartha_addr', 'kingston_addr',
    'hamilton_addr', 'niagara_addr', 
    'waterloo_addr', 'guelph_bldg',
    'london_addr', 'windsor_addr',
    'barrie_addr', 'brantford_addr',
    'halton_addr', 'guelph_addr'
  ],
  'western_canada': [
    'vancouver_addr', 'vancouver_bldg',
    'surrey_addr', 'surrey_bldg',
    'burnaby_addr', 'burnaby_bldg',
    'richmond_addr', 'richmond_bldg',
    'victoria_addr', 'victoria_bldg',
    'kelowna_addr', 'kelowna_bldg',
    'kamloops_addr', 'kamloops_bldg',
    'nanaimo_bldg',
    'calgary_addr', 'calgary_bldg',
    'edmonton_addr', 'edmonton_bldg',
    'reddeer_addr', 'reddeer_bldg',
    'saskatoon_addr', 'saskatoon_bldg',
    'winnipeg_addr', 'winnipeg_bldg'
  ],
  'atlantic_canada': [
    'halifax_addr'
    // 'stjohns_addr' - URL needs verification
  ]
};

// ============================================================================
// COMBINED MUNICIPAL SOURCES
// ============================================================================

export interface MunicipalSource {
  id: string;              // Unique identifier
  name: string;            // Human-readable name
  url: string;             // ArcGIS FeatureServer URL (or CKAN base URL for display)
  s3Key: string;           // Destination in S3
  type: 'address' | 'building';
  province: string;        // e.g., 'ON', 'BC'
  city?: string;           // Primary city if applicable
  /** 'ckan' = Toronto CKAN Open Data API; default = ArcGIS */
  api?: 'arcgis' | 'ckan';
  /** CKAN datastore resource id (required when api === 'ckan') */
  ckanResourceId?: string;
  /** CKAN base URL (default Toronto Open Data) */
  ckanBaseUrl?: string;
  // Building-specific filters
  filters?: {
    minArea?: number;      // Minimum area in sqm (filter out sheds)
    maxArea?: number;      // Maximum area (filter out massive warehouses if needed)
    types?: string[];      // Filter by building type
  };
  // Field mappings for different ArcGIS schemas
  fieldMap?: {
    streetNumber?: string;
    streetNumberSuffix?: string;
    streetName?: string;
    streetNameFull?: string;  // Single field for full street name (e.g. Toronto LINEAR_NAME_FULL)
    streetType?: string;
    streetDir?: string;
    unit?: string;
    unitType?: string;
    city?: string;
    municipality?: string;
    zip?: string;
    area?: string;         // Field name for area calculation
  };
}

export const MUNICIPAL_SOURCES: MunicipalSource[] = [
  ...ADDRESS_SOURCES,
  ...BUILDING_SOURCES
];

// ============================================================================
// CONSTANTS
// ============================================================================

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
const S3_REGION = process.env.AWS_REGION || 'us-east-2';  // Bucket in Ohio
const PAGE_SIZE = 2000;  // ArcGIS max is typically 2000
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// S3 CLIENT
// ============================================================================

const s3Client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ============================================================================
// TYPES
// ============================================================================

interface ArcGISFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

interface IngestResult {
  sourceId: string;
  fetched: number;
  filtered: number;
  final: number;
  s3Key: string;
  uploaded: boolean;
  durationMs: number;
  error?: string;
}

// ============================================================================
// UTILITIES
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(url: string, params: Record<string, any>, attempt = 1): Promise<T> {
  try {
    const response = await axios.get<T>(url, {
      params,
      timeout: 60000,
      headers: { Accept: 'application/json' },
    });
    return response.data;
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await sleep(delay);
      return fetchWithRetry(url, params, attempt + 1);
    }
    throw error;
  }
}

/**
 * Parse address string like "123 Main St" or "456 Elm Ave Unit 5"
 */
function parseAddress(fullAddr: string): { number: string; street: string; unit?: string } {
  const trimmed = fullAddr.trim();
  
  // Match number at start (handles "123A", "123-125")
  const numberMatch = trimmed.match(/^(\d+[A-Z]?(-\d+[A-Z]?)?)/i);
  if (!numberMatch) {
    return { number: '', street: trimmed };
  }
  
  const number = numberMatch[1];
  let remainder = trimmed.slice(number.length).trim();
  
  // Check for unit indicators
  const unitMatch = remainder.match(/\s+(unit|apt|suite|#|apt\.|suite\.)\s*(.+)$/i);
  let unit: string | undefined;
  let street: string;
  
  if (unitMatch) {
    unit = unitMatch[2].trim();
    street = remainder.slice(0, unitMatch.index).trim();
  } else {
    street = remainder;
  }
  
  return { number, street, unit };
}

/**
 * Filter building features by area
 */
function filterBuildings(features: ArcGISFeature[], minArea?: number, maxArea?: number): ArcGISFeature[] {
  return features.filter(f => {
    // ArcGIS area fields - try common names
    const area = 
      f.properties['Shape.STArea()'] ||
      f.properties['Shape_Area'] ||
      f.properties['AREA'] ||
      f.properties['area'] ||
      f.properties['Shape_Area_1'];
    
    if (!area) return true;  // Keep if no area field
    
    const areaNum = parseFloat(area);
    if (isNaN(areaNum)) return true;
    
    if (minArea && areaNum < minArea) return false;
    if (maxArea && areaNum > maxArea) return false;
    
    return true;
  });
}

/**
 * Transform address feature to standardized schema
 */
function transformAddress(feature: ArcGISFeature, source: MunicipalSource): ArcGISFeature {
  const props = feature.properties;
  const map = source.fieldMap || {};
  
  // Treat "None" string (e.g. from Toronto/ArcGIS) as empty
  const blank = (v: any) => v == null || v === '' || String(v).trim().toLowerCase() === 'none';

  // Street number: prefer mapped field; for Toronto (ArcGIS or CKAN) use ADDRESS_NUMBER only, or LO_NUM as fallback
  let rawNum = props[map.streetNumber || 'CIVIC_NUM'];
  if (typeof rawNum === 'number') rawNum = String(rawNum);  // CKAN sometimes returns number
  let streetNumber: string = rawNum ?? '';
  if (blank(streetNumber)) {
    if ((source.id === 'toronto_addresses' || source.id === 'toronto_addresses_ckan') && props.LO_NUM != null) {
      streetNumber = String(props.LO_NUM);
    } else {
      streetNumber = '';
    }
  } else {
    streetNumber = String(streetNumber).trim();
  }
  const suffix = props[map.streetNumberSuffix || 'CIVIC_SFX'];
  if (!blank(suffix)) streetNumber += String(suffix).trim();
  streetNumber = streetNumber.replace(/\s*none\s*/gi, '').trim() || '';

  // Street name: prefer full-name field when present (e.g. Toronto LINEAR_NAME_FULL = "Westhead Rd")
  let streetName: string;
  const fullName = map.streetNameFull && props[map.streetNameFull];
  if (!blank(fullName)) {
    streetName = String(fullName).trim().replace(/\s*none\s*/gi, '');
  } else {
    const streetParts = [
      props[map.streetName || 'ROAD_NAME'],
      props[map.streetType || 'ROAD_TYPE'],
      props[map.streetDir || 'ROAD_DIR']
    ].filter(v => !blank(v)).map(v => String(v).trim());
    streetName = streetParts.join(' ').replace(/\s*none\s*/gi, '').trim() || '';
  }
  
  // Build unit string (e.g., "Apt 5" or just "5")
  const unitType = props[map.unitType || 'UNIT_TYPE'];
  const unitNum = props[map.unit || 'UNIT_NUM'];
  const unit = unitType && unitNum ? `${unitType} ${unitNum}` : unitNum || null;
  
  // Build full address for reference
  const fullAddrParts = [streetNumber, streetName];
  if (unit) fullAddrParts.push(unit);
  fullAddrParts.push(props[map.city || 'TOWN']);
  fullAddrParts.push(props[map.zip || 'POSTAL_CODE']);
  const fullAddr = fullAddrParts.filter(Boolean).join(', ');
  
  const city = props[map.city || 'TOWN'] || props[map.municipality || 'MUNICIPALITY'] || source.city || 'Unknown';
  const zip = props[map.zip || 'POSTAL_CODE'] || props.POSTALCODE || props.ZIP || null;

  // Omit raw ArcGIS fields that can confuse (e.g. LO_NUM, HI_NUM) so only clean standardized fields show
  const { LO_NUM, HI_NUM, LO_NUM_SUF, HI_NUM_SUF, ...restProps } = props as Record<string, unknown> & { LO_NUM?: number; HI_NUM?: number; LO_NUM_SUF?: string; HI_NUM_SUF?: string };

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      _full_address: fullAddr,
      _source_id: source.id,
      _source_url: source.url,
      _fetched_at: new Date().toISOString(),
      ...restProps,
      street_number: streetNumber,
      street_name: streetName,
      unit: unit,
      city,
      zip,
      province: source.province,
      country: 'CA',
    },
  };
}

/**
 * Transform building feature to standardized schema
 */
function transformBuilding(feature: ArcGISFeature, source: MunicipalSource): ArcGISFeature {
  const props = feature.properties;
  const map = source.fieldMap || {};
  
  // Calculate area
  const area = 
    props['Shape.STArea()'] ||
    props['Shape_Area'] ||
    props['AREA'] ||
    props['area'];
  
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      // Standardized fields
      external_id: props.OBJECTID || props.id || props.BUILDINGID || null,
      area_sqm: area ? parseFloat(area) : null,
      building_type: props.BUILDINGTYPE || props.type || null,
      subtype: props.SUBTYPE || props.subtype || null,
      
      // Address fields if available
      primary_address: props.FULLADDR || props.ADDRESS || null,
      primary_street_number: props.STNUM || props.HOUSENUM || null,
      primary_street_name: props.STNAME || props.STREET || null,
      
      province: source.province,
      
      // Metadata
      _source_id: source.id,
      _source_url: source.url,
      _fetched_at: new Date().toISOString(),
      
      // Include original properties
      ...props,
    },
  };
}

// ============================================================================
// ARCGIS FETCH (The Claw)
// ============================================================================

async function fetchFromArcGIS(source: MunicipalSource, maxRecords?: number): Promise<ArcGISFeature[]> {
  console.log(`\nFetching from ArcGIS: ${source.name}`);
  console.log(`  URL: ${source.url}`);
  console.log(`  Type: ${source.type}`);
  if (maxRecords != null) console.log(`  Sample limit: ${maxRecords} records`);
  
  const allFeatures: ArcGISFeature[] = [];
  let offset = 0;
  let pageCount = 0;
  const pageSize = maxRecords != null ? Math.min(PAGE_SIZE, maxRecords) : PAGE_SIZE;
  let hasMore = true;
  
  while (hasMore) {
    pageCount++;
    
    const params: Record<string, any> = {
      where: '1=1',
      outFields: '*',
      f: 'geojson',
      outSR: '4326',  // WGS84
      resultOffset: offset,
      resultRecordCount: pageSize,
    };
    
    // Buildings may need geometry precision
    if (source.type === 'building') {
      params.geometryPrecision = 6;
    }
    
    console.log(`  Page ${pageCount}: offset=${offset}...`);
    
    try {
      const url = `${source.url}/query`;
      const data = await fetchWithRetry<any>(url, params);
      
      if (!data.features || !Array.isArray(data.features)) {
        console.warn('  Warning: No features array in response');
        break;
      }
      
      const pageFeatures = data.features;
      
      // Transform based on type
      const transformed = pageFeatures.map((f: ArcGISFeature) =>
        source.type === 'address' 
          ? transformAddress(f, source)
          : transformBuilding(f, source)
      );
      
      allFeatures.push(...transformed);
      
      // Check if we've reached the end (or sample limit)
      const receivedCount = pageFeatures.length;
      if (maxRecords != null) {
        hasMore = false;  // One page only for sample
      } else {
        hasMore = receivedCount === PAGE_SIZE || data.exceededTransferLimit === true;
      }
      
      console.log(`    Received ${receivedCount} features (total: ${allFeatures.length})`);
      
      if (hasMore && maxRecords == null) {
        offset += receivedCount;
        await sleep(100);
      }
      
    } catch (error: any) {
      console.error(`  Error on page ${pageCount}:`, error.message);
      if (error.response) {
        console.error(`  Status: ${error.response.status}`);
      }
      throw error;
    }
  }
  
  console.log(`  Total pages: ${pageCount}`);
  console.log(`  Total features fetched: ${allFeatures.length}`);
  
  return allFeatures;
}

// ============================================================================
// CKAN FETCH (Toronto Open Data – datastore_search)
// ============================================================================

const CKAN_PAGE_SIZE = 2000;

async function fetchFromCKAN(source: MunicipalSource, maxRecords?: number): Promise<ArcGISFeature[]> {
  const base = source.ckanBaseUrl || 'https://ckan0.cf.opendata.inter.prod-toronto.ca';
  const resourceId = source.ckanResourceId;
  if (!resourceId) throw new Error(`CKAN source ${source.id} missing ckanResourceId`);

  console.log(`\nFetching from CKAN: ${source.name}`);
  console.log(`  Base: ${base}`);
  console.log(`  Resource: ${resourceId}`);
  console.log(`  Type: ${source.type}`);
  if (maxRecords != null) console.log(`  Sample limit: ${maxRecords} records`);

  const allFeatures: ArcGISFeature[] = [];
  let offset = 0;
  let pageCount = 0;
  const searchUrl = `${base}/api/3/action/datastore_search`;
  const limit = maxRecords != null ? Math.min(CKAN_PAGE_SIZE, maxRecords) : CKAN_PAGE_SIZE;

  while (true) {
    pageCount++;
    console.log(`  Page ${pageCount}: offset=${offset}...`);

    const data = await fetchWithRetry<{
      success: boolean;
      result?: {
        records?: Record<string, unknown>[];
        total?: number;
        _links?: { next?: string };
      };
    }>(searchUrl, {
      id: resourceId,
      limit,
      offset,
    });

    if (!data.success || !data.result?.records?.length) {
      console.log(`    No more records.`);
      break;
    }

    const records = data.result.records;
    for (const rec of records) {
      const geomRaw = rec['geometry'];
      let geometry: { type: string; coordinates: number[] } = { type: 'Point', coordinates: [0, 0] };
      if (typeof geomRaw === 'string') {
        try {
          geometry = JSON.parse(geomRaw) as { type: string; coordinates: number[] };
        } catch {
          continue;
        }
      } else if (geomRaw && typeof geomRaw === 'object' && Array.isArray((geomRaw as any).coordinates)) {
        geometry = geomRaw as { type: string; coordinates: number[] };
      } else {
        continue;
      }

      const { geometry: _g, _id: _i, ...props } = rec as Record<string, unknown> & { geometry?: string; _id?: number };
      const feature: ArcGISFeature = {
        type: 'Feature',
        geometry,
        properties: { ...props } as Record<string, any>,
      };
      const transformed =
        source.type === 'address' ? transformAddress(feature, source) : feature;
      allFeatures.push(transformed);
    }

    console.log(`    Received ${records.length} features (total: ${allFeatures.length})`);
    if (maxRecords != null || records.length < CKAN_PAGE_SIZE) break;
    offset += records.length;
    await sleep(150);
  }

  console.log(`  Total pages: ${pageCount}`);
  console.log(`  Total features fetched: ${allFeatures.length}`);
  return allFeatures;
}

// ============================================================================
// FILTER & CLEAN
// ============================================================================

function cleanFeatures(features: ArcGISFeature[], source: MunicipalSource): {
  cleaned: ArcGISFeature[];
  filtered: number;
} {
  console.log('\nCleaning features...');
  
  let filtered = 0;
  let cleaned = features;
  
  // Filter buildings by area
  if (source.type === 'building' && source.filters?.minArea) {
    const beforeCount = cleaned.length;
    cleaned = filterBuildings(cleaned, source.filters.minArea, source.filters.maxArea);
    filtered = beforeCount - cleaned.length;
    console.log(`  Filtered out ${filtered} buildings < ${source.filters.minArea} sqm`);
  }
  
  // Remove features without geometry
  const withGeometry = cleaned.filter(f => f.geometry && f.geometry.coordinates);
  const noGeometry = cleaned.length - withGeometry.length;
  if (noGeometry > 0) {
    console.log(`  Removed ${noGeometry} features without geometry`);
    filtered += noGeometry;
    cleaned = withGeometry;
  }
  
  console.log(`  Final feature count: ${cleaned.length}`);
  
  return { cleaned, filtered };
}

// ============================================================================
// S3 UPLOAD
// ============================================================================

async function uploadToS3(
  source: MunicipalSource,
  features: ArcGISFeature[],
  dryRun: boolean
): Promise<boolean> {
  const metadata = {
    source_id: source.id,
    source_name: source.name,
    source_url: source.url,
    source_type: source.type,
    province: source.province,
    fetched_at: new Date().toISOString(),
    feature_count: features.length,
    filters_applied: source.filters || null,
  };

  console.log(`\nUploading to S3:`);
  console.log(`  Bucket: ${S3_BUCKET}`);
  console.log(`  Key: ${source.s3Key}`);
  console.log(`  Features: ${features.length.toLocaleString()}`);

  if (dryRun) {
    console.log('  [DRY RUN] Skipping upload');
    return true;
  }

  const tmpPath = path.join(os.tmpdir(), `claw-${source.id}-${Date.now()}.geojson`);

  try {
    const out = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
    out.write('{"type":"FeatureCollection","features":[');
    for (let i = 0; i < features.length; i++) {
      out.write((i === 0 ? '' : ',') + JSON.stringify(features[i]));
    }
    out.write('],"metadata":' + JSON.stringify(metadata) + '}');
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      out.end();
    });

    const sizeMB = (fs.statSync(tmpPath).size / 1024 / 1024).toFixed(2);
    console.log(`  Size: ${sizeMB} MB (streamed)`);

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: source.s3Key,
      Body: fs.createReadStream(tmpPath),
      ContentType: 'application/geo+json',
      Metadata: {
        'source-id': source.id,
        'source-type': source.type,
        'fetched-at': new Date().toISOString(),
        'feature-count': String(features.length),
      },
    });

    await s3Client.send(command);
    console.log('  ✓ Upload successful');
    return true;
  } catch (error: any) {
    console.error('  ✗ Upload failed:', error.message);
    return false;
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

// ============================================================================
// MAIN INGEST FUNCTION
// ============================================================================

async function ingestSource(source: MunicipalSource, dryRun: boolean): Promise<IngestResult> {
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${source.name}`);
  console.log(`${'='.repeat(60)}`);
  
  const result: IngestResult = {
    sourceId: source.id,
    fetched: 0,
    filtered: 0,
    final: 0,
    s3Key: source.s3Key,
    uploaded: false,
    durationMs: 0,
  };
  
  try {
    // 1. Fetch (ArcGIS or CKAN)
    const features =
      source.api === 'ckan'
        ? await fetchFromCKAN(source)
        : await fetchFromArcGIS(source);
    result.fetched = features.length;
    
    // 2. Clean and filter
    const { cleaned, filtered } = cleanFeatures(features, source);
    result.filtered = filtered;
    result.final = cleaned.length;
    
    // 3. Upload to S3
    result.uploaded = await uploadToS3(source, cleaned, dryRun);
    
  } catch (error: any) {
    result.error = error.message;
    console.error(`\n✗ Ingestion failed:`, error.message);
  }
  
  result.durationMs = Date.now() - startTime;
  
  console.log(`\n  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Status: ${result.error ? 'FAILED' : 'SUCCESS'}`);
  
  return result;
}

// ============================================================================
// DB TABLE CHECK (optional, before claw)
// ============================================================================

/** Verify ref_addresses_gold / ref_buildings_gold exist before ingesting. Requires DATABASE_URL. */
async function checkGoldTablesExist(sources: MunicipalSource[]): Promise<{ ok: boolean; missing: string[] }> {
  const required = new Set<string>();
  if (sources.some(s => s.type === 'address')) required.add('ref_addresses_gold');
  if (sources.some(s => s.type === 'building')) required.add('ref_buildings_gold');
  if (required.size === 0) return { ok: true, missing: [] };

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('--check-db requires DATABASE_URL (e.g. from .env.local).');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [Array.from(required)]
    );
    const present = new Set((res.rows as { table_name: string }[]).map(r => r.table_name));
    const missing = Array.from(required).filter(t => !present.has(t));
    return { ok: missing.length === 0, missing };
  } finally {
    await client.end();
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: 'string' },
      group: { type: 'string' },
      all: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'check-db': { type: 'boolean' },
      sample: { type: 'string' },
      'list-sources': { type: 'boolean' },
      'list-groups': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  
  if (values.help) {
    console.log(`
Gold Tier Ingest Script (The "Claw")

Fetches municipal data from ArcGIS servers, filters noise, uploads to S3.

Usage:
  npx tsx scripts/ingest_municipal_data.ts [options]

Options:
  --source=<id>       Ingest specific source (e.g., toronto_addresses)
  --group=<name>      Ingest a group of sources (for parallel execution)
  --all               Ingest all configured sources
  --dry-run           Fetch data but don't upload to S3
  --check-db          Verify ref_addresses_gold (and ref_buildings_gold) exist before running (requires DATABASE_URL)
  --sample=N          Fetch N records only and print their transformed properties (requires --source). No AWS needed.
  --list-sources      List available sources
  --list-groups       List available groups for parallel execution
  --help              Show this help

Before ingesting: run Supabase migrations so ref_addresses_gold exists (needed when loading from S3 into DB). Use --check-db to verify.

Groups (for --group):
  durham_york_peel    The "Big 3" Ontario neighbors
  toronto_ottawa      The huge cities (Toronto, Ottawa)
  ontario_rest        Smaller Ontario cities
  western_canada      BC, Alberta, Prairies
  atlantic_canada     Nova Scotia, Newfoundland

Examples:
  # Toronto addresses (ArcGIS Layer 101, ~525k points) – ensure migrations applied first
  npx tsx scripts/ingest_municipal_data.ts --source=toronto_addresses --check-db

  # Ingest Durham addresses
  npx tsx scripts/ingest_municipal_data.ts --source=durham_addr

  # Ingest Durham buildings with shed filter
  npx tsx scripts/ingest_municipal_data.ts --source=durham_bldg

  # Test without uploading
  npx tsx scripts/ingest_municipal_data.ts --source=toronto_addresses --dry-run

  # Verify fields locally (no AWS): fetch 5 records and print properties
  npx tsx scripts/ingest_municipal_data.ts --source=toronto_addresses_ckan --sample=5

  # Ingest all of Western Canada (parallel execution)
  npx tsx scripts/ingest_municipal_data.ts --group=western_canada

  # Ingest everything
  npx tsx scripts/ingest_municipal_data.ts --all

Environment Variables:
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_BUCKET_NAME
    `);
    process.exit(0);
  }
  
  if (values['list-groups']) {
    console.log('Available groups for parallel execution:\n');
    for (const [groupName, sourceIds] of Object.entries(GROUPS)) {
      console.log(`${groupName}`);
      console.log(`  Sources: ${sourceIds.length}`);
      console.log(`  IDs: ${sourceIds.join(', ')}`);
      console.log('');
    }
    process.exit(0);
  }
  
  if (values['list-sources']) {
    console.log(`Configured municipal sources: ${MUNICIPAL_SOURCES.length}\n`);
    
    // Group by type
    const addresses = MUNICIPAL_SOURCES.filter(s => s.type === 'address');
    const buildings = MUNICIPAL_SOURCES.filter(s => s.type === 'building');
    
    console.log(`Addresses: ${addresses.length}`);
    addresses.forEach(s => {
      console.log(`  ${s.id} - ${s.name} (${s.province})`);
    });
    
    console.log(`\nBuildings: ${buildings.length}`);
    buildings.forEach(s => {
      console.log(`  ${s.id} - ${s.name} (${s.province})`);
    });
    process.exit(0);
  }

  // --sample=N: fetch a few records and print transformed properties (no AWS, no upload)
  if (values.sample != null) {
    const n = Math.min(100, Math.max(1, parseInt(values.sample, 10) || 3));
    if (!values.source) {
      console.error('Error: --sample requires --source=<id>');
      console.log('Example: npx tsx scripts/ingest_municipal_data.ts --source=toronto_addresses_ckan --sample=5');
      process.exit(1);
    }
    const source = MUNICIPAL_SOURCES.find(s => s.id === values.source);
    if (!source) {
      console.error(`Unknown source: ${values.source}`);
      process.exit(1);
    }
    console.log(`\nSample mode: fetching up to ${n} records from ${source.name} (${source.id})\n`);
    const features =
      source.api === 'ckan'
        ? await fetchFromCKAN(source, n)
        : await fetchFromArcGIS(source, n);
    const { cleaned } = cleanFeatures(features, source);
    const sample = cleaned.slice(0, n);
    const out = sample.map(f => ({
      properties: f.properties,
      geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates },
    }));
    console.log('\n--- Transformed features (properties + geometry) ---\n');
    console.log(JSON.stringify(out, null, 2));
    console.log('\n--- Required for load_gold_direct: street_number, street_name, city (and geom) ---');
    process.exit(0);
  }
  
  // Validate AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: AWS credentials not found');
    console.error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    process.exit(1);
  }
  
  // Determine sources to process
  let sources: MunicipalSource[] = [];
  
  if (values.all) {
    sources = MUNICIPAL_SOURCES;
  } else if (values.group) {
    // Run a specific group (GitHub Action Matrix)
    const groupName = values.group;
    const targetIds = GROUPS[groupName];
    if (!targetIds) {
      console.error(`Unknown group: ${groupName}`);
      console.log('Available:', Object.keys(GROUPS).join(', '));
      process.exit(1);
    }
    sources = MUNICIPAL_SOURCES.filter(s => targetIds.includes(s.id));
    if (sources.length === 0) {
      console.error(`No sources found for group: ${groupName}`);
      process.exit(1);
    }
  } else if (values.source) {
    const source = MUNICIPAL_SOURCES.find(s => s.id === values.source);
    if (!source) {
      console.error(`Unknown source: ${values.source}`);
      console.log('Available:', MUNICIPAL_SOURCES.map(s => s.id).join(', '));
      process.exit(1);
    }
    sources = [source];
  } else {
    console.error('Error: Must specify --source=<id>, --group=<name>, or --all');
    console.log('Use --list-sources to see available sources');
    console.log('Use --list-groups to see available groups');
    process.exit(1);
  }

  if (values['check-db']) {
    const check = await checkGoldTablesExist(sources);
    if (!check.ok) {
      console.error(`Missing table(s): ${check.missing.join(', ')}. Run Supabase migrations first (e.g. supabase db push).`);
      process.exit(1);
    }
    console.log('✓ DB check passed:', [...(sources.some(s => s.type === 'address') ? ['ref_addresses_gold'] : []), ...(sources.some(s => s.type === 'building') ? ['ref_buildings_gold'] : [])].join(', '));
  }
  
  const dryRun = values['dry-run'] || false;
  
  console.log('========================================');
  console.log('Gold Tier Ingest (The "Claw")');
  console.log('========================================');
  console.log(`Sources: ${sources.length}`);
  if (values.group) {
    console.log(`Group: ${values.group}`);
  }
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`S3 Bucket: ${S3_BUCKET}`);
  console.log('');
  
  // Process each source
  const results: IngestResult[] = [];
  
  for (const source of sources) {
    const result = await ingestSource(source, dryRun);
    results.push(result);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const r of results) {
    const status = r.error ? '❌ FAILED' : '✅ SUCCESS';
    console.log(`\n${r.sourceId}: ${status}`);
    console.log(`  Fetched: ${r.fetched.toLocaleString()}`);
    console.log(`  Filtered: ${r.filtered.toLocaleString()}`);
    console.log(`  Final: ${r.final.toLocaleString()}`);
    console.log(`  S3: ${r.s3Key}`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
      failCount++;
    } else {
      successCount++;
    }
  }
  
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Success: ${successCount} | Failed: ${failCount}`);
  console.log('='.repeat(60));
  
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
