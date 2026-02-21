#!/usr/bin/env python3
"""
Ontario Municipal ArcGIS Data Downloader
Handles all the specific ArcGIS REST endpoints from your list
"""

import requests
import json
import time
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Complete list of Ontario municipal ArcGIS REST endpoints from your research
ONTARIO_ARCGIS_ENDPOINTS = {
    # Region of Peel (Mississauga, Brampton, Caledon)
    'peel': {
        'buildings': 'https://services1.arcgis.com/pMe2nEI0E1E4F5X7/arcgis/rest/services/Building_Footprint/FeatureServer/0',
        'addresses': 'https://services.arcgis.com/hRUr1F8lE8Jq2uJo/arcgis/rest/services/Address_Points_2/FeatureServer/0',
        'parcels': 'https://services1.arcgis.com/pMe2nEI0E1E4F5X7/arcgis/rest/services/Parcel/FeatureServer/0',
        'caledon_buildings': 'https://services.arcgis.com/hRUr1F8lE8Jq2uJo/arcgis/rest/services/Building_Footprints_Caledon_2022/FeatureServer/0'
    },
    
    # City of Mississauga
    'mississauga': {
        'buildings': 'https://services6.arcgis.com/mG7H7yWb90554783/arcgis/rest/services/Building_Footprints/FeatureServer/0'
    },
    
    # City of Brampton
    'brampton': {
        'buildings': 'https://services5.arcgis.com/54321/arcgis/rest/services/Building_Footprints/FeatureServer/0'
    },
    
    # Region of Niagara
    'niagara': {
        'buildings': 'https://services.arcgis.com/G3O1Kx0d72A80a8M/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'addresses': 'https://services.arcgis.com/G3O1Kx0d72A80a8M/arcgis/rest/services/OD_ADDRESSPOINTS/FeatureServer/0',
        'parcels': 'https://services.arcgis.com/G3O1Kx0d72A80a8M/arcgis/rest/services/Parcels/FeatureServer/0'
    },
    
    # Region of Waterloo (Kitchener, Waterloo, Cambridge)
    'waterloo': {
        'buildings': 'https://services1.arcgis.com/qN3F9F55d6776b9g/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'addresses': 'https://services1.arcgis.com/qN3F9F55d6776b9g/arcgis/rest/services/Address_Points/FeatureServer/0'
    },
    
    # City of Guelph
    'guelph': {
        'buildings': 'https://services2.arcgis.com/NFWw2Z4c0ZJ5qC9G/arcgis/rest/services/General_Building/FeatureServer/0',
        'addresses': 'https://services2.arcgis.com/NFWw2Z4c0ZJ5qC9G/arcgis/rest/services/Address/FeatureServer/0'
    },
    
    # City of London
    'london': {
        'buildings': 'https://services.arcgis.com/l4L4s5S12X7a1j66/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'parcels': 'https://services.arcgis.com/l4L4s5S12X7a1j66/arcgis/rest/services/Parcels/FeatureServer/0'
    },
    
    # City of Hamilton
    'hamilton': {
        'buildings': 'https://services.arcgis.com/tLbd589f21f72a4b/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'addresses': 'https://services.arcgis.com/tLbd589f21f72a4b/arcgis/rest/services/Address_Points/FeatureServer/0'
    },
    
    # Halton Region Towns
    'burlington': {
        'buildings': 'https://services.arcgis.com/N0l9vJ857K32BwD3/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'addresses': 'https://services.arcgis.com/N0l9vJ857K32BwD3/arcgis/rest/services/Address_Points/FeatureServer/0'
    },
    
    'milton': {
        'buildings': 'https://services1.arcgis.com/1g263c323f434234/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        'addresses': 'https://services1.arcgis.com/1g263c323f434234/arcgis/rest/services/Address_Points/FeatureServer/0'
    },
    
    'oakville': {
        'buildings': 'https://agsportal.oakville.ca/oakgis/rest/services/OpenData/Building_Footprints/MapServer/0',
        'addresses': 'https://agsportal.oakville.ca/oakgis/rest/services/OpenData/Address_Points/MapServer/0'
    }
}

class OntarioArcGISDownloader:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Ontario-GIS-Pipeline/1.0',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        })
    
    def test_endpoint(self, url: str) -> Tuple[bool, str]:
        """Test if an ArcGIS endpoint is accessible"""
        try:
            # Test the service info endpoint first
            service_info_url = url.rsplit('/', 1)[0]  # Remove the layer number
            
            response = self.session.get(f"{service_info_url}?f=json", timeout=30)
            response.raise_for_status()
            
            service_info = response.json()
            if 'error' in service_info:
                return False, f"Service error: {service_info['error'].get('message', 'Unknown error')}"
            
            # Test the layer query endpoint
            params = {
                'f': 'json',
                'where': '1=1',
                'returnGeometry': 'false',
                'outFields': '1',
                'resultRecordCount': 1
            }
            
            response = self.session.get(f"{url}/query", params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if 'error' in data:
                return False, f"Query error: {data['error'].get('message', 'Unknown error')}"
            
            return True, "Endpoint accessible"
            
        except requests.exceptions.RequestException as e:
            return False, f"Request failed: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"
    
    def get_feature_count(self, url: str) -> Optional[int]:
        """Get total feature count from ArcGIS service"""
        try:
            params = {
                'f': 'json',
                'where': '1=1',
                'returnCountOnly': 'true'
            }
            
            response = self.session.get(f"{url}/query", params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if 'count' in data:
                return data['count']
            return None
            
        except Exception as e:
            logger.error(f"Failed to get feature count for {url}: {e}")
            return None
    
    def download_all_features(self, url: str, output_file: Path, data_type: str, region: str) -> bool:
        """Download all features from ArcGIS REST API with pagination"""
        try:
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Get total count first
            total_count = self.get_feature_count(url)
            if total_count is None:
                logger.warning(f"Could not get feature count for {region} {data_type}, trying direct download")
                return self.download_features_direct(url, output_file, data_type, region)
            
            logger.info(f"📊 {region} {data_type}: {total_count:,} total features")
            
            all_features = []
            offset = 0
            batch_size = 1000
            
            while offset < total_count:
                logger.info(f"📡 Downloading {region} {data_type}: {offset+1}-{min(offset+batch_size, total_count)} of {total_count:,}")
                
                params = {
                    'f': 'json',
                    'where': '1=1',
                    'returnGeometry': 'true',
                    'outFields': '*',
                    'outSR': '4326',
                    'resultOffset': offset,
                    'resultRecordCount': batch_size
                }
                
                response = self.session.get(f"{url}/query", params=params, timeout=300)
                response.raise_for_status()
                
                data = response.json()
                if 'error' in data:
                    logger.error(f"ArcGIS error for {region} {data_type}: {data['error']}")
                    return False
                
                if 'features' not in data:
                    logger.warning(f"No features in response for {region} {data_type}")
                    break
                
                batch_features = data['features']
                all_features.extend(batch_features)
                
                if len(batch_features) < batch_size:
                    break  # Last batch
                
                offset += batch_size
                time.sleep(1)  # Be respectful to the API
            
            # Create GeoJSON
            geojson_data = {
                "type": "FeatureCollection",
                "features": all_features,
                "properties": {
                    "region": region,
                    "data_type": data_type,
                    "source_url": url,
                    "download_date": "2026-02-20",
                    "record_count": len(all_features),
                    "total_count": total_count
                }
            }
            
            with open(output_file, 'w') as f:
                json.dump(geojson_data, f, indent=2)
            
            logger.info(f"💾 Saved {len(all_features):,} features to {output_file}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download all features for {region} {data_type}: {e}")
            return False
    
    def download_features_direct(self, url: str, output_file: Path, data_type: str, region: str) -> bool:
        """Direct download without pagination (fallback method)"""
        try:
            logger.info(f"📡 Direct download for {region} {data_type}")
            
            params = {
                'f': 'json',
                'where': '1=1',
                'returnGeometry': 'true',
                'outFields': '*',
                'outSR': '4326'
            }
            
            response = self.session.get(f"{url}/query", params=params, timeout=600)
            response.raise_for_status()
            
            data = response.json()
            if 'error' in data:
                logger.error(f"ArcGIS error for {region} {data_type}: {data['error']}")
                return False
            
            if 'features' not in data:
                logger.warning(f"No features found for {region} {data_type}")
                return False
            
            features = data['features']
            logger.info(f"💾 Downloaded {len(features):,} features for {region} {data_type}")
            
            # Create GeoJSON
            geojson_data = {
                "type": "FeatureCollection",
                "features": features,
                "properties": {
                    "region": region,
                    "data_type": data_type,
                    "source_url": url,
                    "download_date": "2026-02-20",
                    "record_count": len(features)
                }
            }
            
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with open(output_file, 'w') as f:
                json.dump(geojson_data, f, indent=2)
            
            logger.info(f"💾 Saved {len(features):,} features to {output_file}")
            return True
            
        except Exception as e:
            logger.error(f"Direct download failed for {region} {data_type}: {e}")
            return False
    
    def download_region_data(self, region: str, output_dir: Path) -> Dict[str, bool]:
        """Download all data types for a region"""
        results = {}
        
        if region not in ONTARIO_ARCGIS_ENDPOINTS:
            logger.error(f"Region {region} not found in endpoints")
            return results
        
        region_endpoints = ONTARIO_ARCGIS_ENDPOINTS[region]
        output_dir = output_dir / region
        output_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"🗺️ Processing {region} region...")
        
        # Test endpoint first
        buildings_url = region_endpoints.get('buildings')
        if buildings_url:
            logger.info(f"Testing {region} buildings endpoint...")
            accessible, message = self.test_endpoint(buildings_url)
            if accessible:
                logger.info(f"✅ {region} buildings: {message}")
                success = self.download_all_features(buildings_url, output_dir / f"{region}_buildings.geojson", "buildings", region)
                results['buildings'] = success
            else:
                logger.warning(f"⚠️ {region} buildings: {message}")
                results['buildings'] = False
        
        addresses_url = region_endpoints.get('addresses')
        if addresses_url:
            logger.info(f"Testing {region} addresses endpoint...")
            accessible, message = self.test_endpoint(addresses_url)
            if accessible:
                logger.info(f"✅ {region} addresses: {message}")
                success = self.download_all_features(addresses_url, output_dir / f"{region}_addresses.geojson", "addresses", region)
                results['addresses'] = success
            else:
                logger.warning(f"⚠️ {region} addresses: {message}")
                results['addresses'] = False
        
        # Handle special cases (like Caledon buildings)
        caledon_buildings_url = region_endpoints.get('caledon_buildings')
        if caledon_buildings_url and region == 'peel':
            logger.info(f"Testing {region} Caledon buildings endpoint...")
            accessible, message = self.test_endpoint(caledon_buildings_url)
            if accessible:
                logger.info(f"✅ {region} Caledon buildings: {message}")
                success = self.download_all_features(caledon_buildings_url, output_dir / f"caledon_buildings.geojson", "buildings", "caledon")
                results['caledon_buildings'] = success
            else:
                logger.warning(f"⚠️ {region} Caledon buildings: {message}")
                results['caledon_buildings'] = False
        
        logger.info(f"📊 {region} processing complete: {results}")
        return results

def main():
    """Main function to test the downloader"""
    downloader = OntarioArcGISDownloader()
    
    # Test a few key regions first
    test_regions = ['toronto', 'peel', 'niagara', 'waterloo']
    output_dir = Path("data")
    
    print("🗺️ Ontario Municipal ArcGIS Data Downloader")
    print("=" * 60)
    
    all_results = {}
    
    for region in test_regions:
        print(f"\n📡 Testing {region}...")
        results = downloader.download_region_data(region, output_dir)
        all_results[region] = results
    
    print("\n" + "=" * 60)
    print("📊 Final Results Summary:")
    for region, results in all_results.items():
        print(f"{region}: {results}")
    
    print("\n✅ Download complete! Check the 'data' folder for GeoJSON files.")

if __name__ == "__main__":
    main()