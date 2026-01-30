# 3D Rendering Analysis: Fill Extrusion vs 3D Models

## Executive Summary

Your codebase uses **two distinct 3D rendering techniques** for building visualization:

1. **Fill Extrusion (2.5D)** - Mapbox native `fill-extrusion` layers
2. **3D Models (True 3D)** - Three.js with GLB/GLTF models

Both systems coexist and are used in different contexts. This document provides a comprehensive audit and comparison.

---

## 1. Codebase Audit: 3D Rendering Implementations

### Summary Table

| File | Technique | Layer ID | Data Source | Use Case |
|------|-----------|----------|-------------|----------|
| `MapBuildingsLayer.tsx` | Fill Extrusion | `map-buildings-extrusion` | `map_buildings` table (PostGIS Polygons) | Campaign building visualization with real-time stats |
| `BuildingLayers.tsx` (2D mode) | Fill Extrusion | `flyr-campaign-buildings-extrusion` | Campaign buildings API (GeoJSON Polygons) | 2D city view mode |
| `BuildingLayers.tsx` (3D mode) | 3D Models (Three.js) | `flyr-campaign-buildings-model-layer` | Campaign addresses API (GeoJSON Points) | 3D Monopoly house view |
| `ThreeHouseLayer.tsx` | 3D Models (Three.js) | `flyr-campaign-buildings-model-layer` | GLB file: `/House2.glb` | Custom Mapbox layer for GLB rendering |
| `OvertureMap.tsx` | 3D Models (Three.js) | `flyr-campaign-buildings-model-layer` | Overture API + `/House2.glb` | Overture building data visualization |

### Detailed Breakdown

#### Fill Extrusion Implementations

**1. `MapBuildingsLayer.tsx`**
- **Type**: `fill-extrusion`
- **Source**: `map-buildings-source` (GeoJSON)
- **Data**: Fetched from `rpc_get_buildings_in_bbox` (PostGIS function)
- **Properties Used**:
  - `height` - Building height in meters
  - `min_height` - Base height (usually 0)
  - `status` - Building status (hot, visited, etc.)
  - `last_scan_seconds_ago` - For real-time color updates
- **Styling**:
  - Dynamic colors based on scan status
  - Vertical gradient enabled
  - Opacity: 0.9
- **Interactions**: Click handler for building selection
- **Performance**: Viewport-based fetching (only loads buildings in view)

**2. `BuildingLayers.tsx` (2D Mode)**
- **Type**: `fill-extrusion`
- **Source**: `flyr-campaign-buildings-source` (GeoJSON)
- **Data**: Campaign buildings API (`/api/campaigns/${campaignId}/buildings`)
- **Properties Used**:
  - `height` - Building height
  - `min_height` - Base height
  - `status` - Building status
- **Styling**:
  - Green for "done" status
  - Red for "pending" status
  - Opacity: 0.98
- **Fallback**: Circle markers for Point geometries

#### 3D Model Implementations

**1. `ThreeHouseLayer.tsx` (Custom Mapbox Layer)**
- **Type**: Custom Three.js layer
- **Model File**: `/House2.glb` (loaded via GLTFLoader)
- **Data**: `BuildingModelPoint[]` (GeoJSON Points with properties)
- **Features**:
  - Model cloning for each building instance
  - Dynamic scaling based on latitude and zoom
  - Bearing-based rotation (house orientation)
  - Collision detection and resolution
  - LOD support (optional low-detail models)
  - Contact shadows (texture-based)
  - Real-time color updates
  - Raycasting for click detection
- **Performance Optimizations**:
  - TODO: InstancedMesh for hundreds of models (currently clones)
  - Zoom-based LOD switching
  - Collision scale reduction (shrinks overlapping models)

**2. `BuildingLayers.tsx` (3D Mode)**
- **Wrapper**: Uses `ThreeHouseLayer` class
- **Data Source**: Campaign addresses API (`/api/campaigns/${campaignId}/addresses`)
- **Model**: `/House2.glb`
- **Fallback**: Circle markers if WebGL not supported
- **Real-time**: Subscribes to building inserts and address updates

**3. `OvertureMap.tsx`**
- **Purpose**: Overture building data visualization
- **Model**: `/House2.glb`
- **Data**: `/api/overture/buildings`

---

## 2. Implementation Comparison

### Height/Scale Determination

#### Fill Extrusion
```typescript
// Height comes directly from GeoJSON properties
'fill-extrusion-height': ['get', 'height'],
'fill-extrusion-base': ['get', 'min_height'],
```
- **Source**: Database column (`height_m`, `levels`)
- **Calculation**: Usually `levels * 3` meters (3m per floor)
- **Dynamic**: Can be updated via data-driven styling
- **Limitation**: Only vertical extrusion (no complex shapes)

#### 3D Models
```typescript
// Complex scaling calculation in ThreeHouseLayer.tsx
const targetSizeMeters = 10; // Target width
const metersPerMercatorUnit = finalMerc.meterInMercatorCoordinateUnits();
const modelMaxDimension = Math.max(baseModelSize.x, baseModelSize.y, baseModelSize.z);
const scaleRatio = targetSizeMeters / modelMaxDimension;
const baseScaleFactor = scaleRatio * metersPerMercatorUnit * SCALE_MULTIPLIER;
```
- **Source**: Model's native bounding box + latitude-based calculation
- **Calculation**: 
  - Base: Model's native size
  - Latitude: Mercator coordinate conversion
  - Zoom: Dynamic scaling based on zoom level
  - Collision: Scale reduction for overlapping models
  - Townhouse: Special scaling (narrower width, taller height)
- **Dynamic**: Per-instance scaling with collision resolution
- **Advantage**: Can represent complex shapes, overhangs, textures

### Lighting and Shadows

#### Fill Extrusion
- **Lighting**: Mapbox handles automatically
- **Shadows**: Mapbox's built-in shadow system
- **Control**: Limited - uses Mapbox's default lighting model
- **Performance**: Excellent - hardware-accelerated by Mapbox

#### 3D Models
```typescript
// Three.js lighting setup
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLight.position.set(0, -70, 100).normalize();
directionalLight.castShadow = false; // Disabled for performance
```
- **Lighting**: Custom Three.js lights
  - Ambient: 60% intensity
  - Directional: 90% intensity (fixed position)
- **Shadows**: 
  - Contact shadows: Texture-based (disabled real-time shadows for performance)
  - Shadow texture: Generated via `MapService.createShadowTexture()`
- **Control**: Full control over lighting direction and intensity
- **Performance**: More expensive - requires custom rendering

### Click/Hover Interactions

#### Fill Extrusion
```typescript
// Mapbox native click handler
map.on('click', layerId, (e) => {
  const feature = e.features[0];
  const props = feature.properties as BuildingProperties;
  if (props.id && onBuildingClick) {
    onBuildingClick(props.id);
  }
});

// Native hover cursor change
map.on('mouseenter', layerId, () => {
  map.getCanvas().style.cursor = 'pointer';
});
```
- **Method**: Mapbox native feature picking
- **Performance**: Excellent - uses Mapbox's optimized hit testing
- **Limitation**: Only works with Mapbox layers

#### 3D Models
```typescript
// Three.js raycasting
private handleMapClick(e: mapboxgl.MapMouseEvent) {
  const canvas = this.map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  this.mouse.x = ((e.point.x - rect.left) / rect.width) * 2 - 1;
  this.mouse.y = -((e.point.y - rect.top) / rect.height) * 2 + 1;
  this.raycaster.setFromCamera(this.mouse, this.camera);
  const intersects = this.raycaster.intersectObjects(/*...*/);
}
```
- **Method**: Three.js raycasting
- **Performance**: Good, but more expensive than Mapbox native
- **Advantage**: Works with custom 3D geometry
- **Complexity**: Requires manual coordinate conversion

### Data Sources

#### Fill Extrusion
- **Format**: GeoJSON Polygons
- **Sources**:
  1. `map_buildings` table (PostGIS) - for `MapBuildingsLayer`
  2. Campaign buildings API - for `BuildingLayers` 2D mode
- **Properties**: Height, status, scan data
- **Update**: Real-time via Supabase subscriptions

#### 3D Models
- **Format**: GeoJSON Points (with properties)
- **Sources**:
  1. Campaign addresses API - for `BuildingLayers` 3D mode
  2. Overture API - for `OvertureMap`
- **Properties**: 
  - `house_bearing`, `front_bearing`, `road_bearing` (orientation)
  - `address_id`, `building_id`, `gers_id` (identifiers)
  - `width_meters`, `is_townhouse` (scaling hints)
  - `scale_factor`, `collision_scale_reduction` (dynamic scaling)
- **Update**: Real-time via Supabase subscriptions + `updateFeatures()`

---

## 3. Performance & Suitability Analysis

### Current Usage Patterns

#### ✅ Appropriate Use Cases

**Fill Extrusion is ideal for:**
1. **`MapBuildingsLayer.tsx`** - Viewport-based building visualization
   - ✅ Thousands of buildings
   - ✅ Real-time status updates
   - ✅ Simple box shapes
   - ✅ High performance requirement

**3D Models are ideal for:**
1. **`BuildingLayers.tsx` (3D mode)** - Campaign visualization
   - ✅ Detailed house models
   - ✅ Orientation-based rotation
   - ✅ Visual appeal (Monopoly house aesthetic)
   - ✅ Moderate count (< 1000 buildings)

#### ⚠️ Potential Issues

**1. Model File Size**
- **Current**: `/House2.glb` - Unknown size
- **Risk**: Large GLB files impact initial load
- **Recommendation**: 
  - Check file size: `ls -lh public/House2.glb`
  - Consider LOD models (already implemented but not used)
  - Optimize GLB with gltf-pipeline

**2. Model Cloning Performance**
```typescript
// Current: Clones model for each building
const modelClone = this.baseModel!.clone(true);
// TODO: Use THREE.InstancedMesh for hundreds of models
```
- **Issue**: Cloning is expensive for 100+ buildings
- **Impact**: Initial load time, memory usage
- **Solution**: Implement `THREE.InstancedMesh` (noted in code)

**3. Collision Detection Overhead**
```typescript
private detectAndResolveCollisions() {
  // O(n²) collision checking
  for (let i = 0; i < modelArray.length; i++) {
    for (let j = i + 1; j < modelArray.length; j++) {
      // Bounding box intersection check
    }
  }
}
```
- **Issue**: O(n²) complexity for collision detection
- **Impact**: Slows down model population
- **Solution**: Use spatial indexing (R-tree, quadtree)

**4. Duplicate Rendering Systems**
- **Issue**: Both `MapBuildingsLayer` and `BuildingLayers` can render buildings
- **Risk**: Confusion about which system is active
- **Recommendation**: Clear separation of concerns

### Refactoring Recommendations

#### High Priority

**1. Implement InstancedMesh for 3D Models**
```typescript
// Replace cloning with instancing
const instancedMesh = new THREE.InstancedMesh(
  geometry, 
  material, 
  modelPoints.length
);
modelPoints.forEach((feature, index) => {
  const matrix = new THREE.Matrix4();
  // Calculate position, rotation, scale
  instancedMesh.setMatrixAt(index, matrix);
});
```
- **Benefit**: 10-100x performance improvement for 100+ buildings
- **Effort**: Medium (requires refactoring `populateModels()`)

**2. Optimize GLB Model**
- **Action**: Run `gltf-pipeline` to compress and optimize
- **Command**: `npx gltf-pipeline -i House2.glb -o House2-optimized.glb -d`
- **Benefit**: Smaller file size, faster loading

**3. Add Spatial Indexing for Collision Detection**
```typescript
// Use a spatial index library (e.g., rbush)
import RBush from 'rbush';

private collisionIndex = new RBush();

// Insert bounding boxes into index
this.models.forEach((record, id) => {
  const box = this.calculateBoundingBox(record.object);
  this.collisionIndex.insert({
    minX: box.min.x, minY: box.min.y,
    maxX: box.max.x, maxY: box.max.y,
    id
  });
});

// Query for collisions (O(n log n) instead of O(n²))
const candidates = this.collisionIndex.search(/*...*/);
```
- **Benefit**: O(n log n) instead of O(n²) for collision detection
- **Effort**: Low (add dependency, refactor collision logic)

#### Medium Priority

**4. LOD System Enhancement**
- **Current**: LOD system exists but not actively used
- **Action**: Create low-poly version of `House2.glb`
- **Usage**: Switch to LOD at zoom < 15
- **Benefit**: Better performance at lower zoom levels

**5. Separate Fill Extrusion and 3D Model Systems**
- **Current**: Both systems can be active simultaneously
- **Action**: Add explicit mode switching UI
- **Benefit**: Clear user control, avoid confusion

#### Low Priority

**6. Model Caching**
- **Action**: Cache loaded GLB models in IndexedDB
- **Benefit**: Faster subsequent loads
- **Effort**: Medium (add caching layer)

**7. Web Worker for Collision Detection**
- **Action**: Move collision detection to Web Worker
- **Benefit**: Non-blocking UI during model population
- **Effort**: High (requires serialization of Three.js objects)

---

## 4. Technical Differences Summary

| Feature | Fill Extrusion | 3D Models |
|---------|---------------|-----------|
| **Code Signature** | `type: 'fill-extrusion'` | `type: 'custom'`, `THREE.Object3D` |
| **Geometry** | GeoJSON Polygon (footprint) | External GLB mesh file |
| **Complexity** | Simple vertical walls only | Complex shapes, overhangs, textures |
| **Performance** | Very high (thousands easily) | Lower (GPU/memory per instance) |
| **Styling** | Dynamic (data-driven colors) | Fixed textures (baked into model) |
| **Height Source** | Database column | Model's native size + scaling |
| **Orientation** | Fixed (no rotation) | Bearing-based rotation |
| **Interactions** | Mapbox native (fast) | Three.js raycasting (slower) |
| **Lighting** | Mapbox default | Custom Three.js lights |
| **Shadows** | Mapbox built-in | Texture-based contact shadows |
| **File Size** | None (data only) | GLB file (can be large) |
| **Initial Load** | Fast (just data) | Slower (model + data) |
| **Real-time Updates** | Excellent (Supabase) | Good (requires re-render) |

---

## 5. Recommendations by Use Case

### Use Fill Extrusion When:
- ✅ Rendering 1000+ buildings
- ✅ Simple box shapes are sufficient
- ✅ Need real-time status updates
- ✅ Performance is critical
- ✅ Building footprints are available

### Use 3D Models When:
- ✅ Visual appeal is important
- ✅ Building orientation matters
- ✅ Complex shapes needed
- ✅ Building count < 500
- ✅ Detailed house visualization

### Hybrid Approach (Current):
- **Fill Extrusion**: `MapBuildingsLayer` for overview
- **3D Models**: `BuildingLayers` (3D mode) for detailed view
- **Recommendation**: ✅ Keep both, but add clear mode switching

---

## 6. Next Steps

1. **Immediate**: Check GLB file size and optimize if > 500KB
2. **Short-term**: Implement `THREE.InstancedMesh` for 3D models
3. **Short-term**: Add spatial indexing for collision detection
4. **Medium-term**: Create and use LOD models
5. **Long-term**: Consider Web Workers for heavy computations

---

## Appendix: File Locations

### Fill Extrusion Files
- `components/map/MapBuildingsLayer.tsx` - Main fill-extrusion layer
- `components/map/BuildingLayers.tsx` (lines 431-528) - 2D mode fill-extrusion
- `supabase/migrations/20251214000000_create_map_buildings_schema.sql` - Database schema
- `types/map-buildings.ts` - TypeScript types

### 3D Model Files
- `components/map/ThreeHouseLayer.tsx` - Custom Three.js layer
- `components/map/BuildingLayers.tsx` (lines 530-705) - 3D mode wrapper
- `components/map/OvertureMap.tsx` - Overture visualization
- `lib/services/MapService.ts` - Building model point creation
- `public/House2.glb` - 3D model file

### Shared Files
- `components/map/FlyrMapView.tsx` - Main map component (uses both)
- `lib/services/MapBuildingsService.ts` - Building data service
