# 3D Rendering Quick Reference

## When to Use Which Technique

### Use Fill Extrusion ✅
- **File**: `MapBuildingsLayer.tsx` or `BuildingLayers.tsx` (2D mode)
- **When**:
  - Rendering 1000+ buildings
  - Simple box shapes are sufficient
  - Need real-time status updates
  - Performance is critical
- **Data**: GeoJSON Polygons with `height` property
- **Layer ID**: `map-buildings-extrusion` or `flyr-campaign-buildings-extrusion`

### Use 3D Models ✅
- **File**: `ThreeHouseLayer.tsx` or `BuildingLayers.tsx` (3D mode)
- **When**:
  - Visual appeal is important
  - Building orientation matters
  - Complex shapes needed
  - Building count < 500
- **Data**: GeoJSON Points with `house_bearing` property
- **Layer ID**: `flyr-campaign-buildings-model-layer`
- **Model**: `/House2.glb` (4.7KB - optimized)

## Code Snippets

### Adding Fill Extrusion Layer
```typescript
map.addLayer({
  id: 'my-buildings',
  type: 'fill-extrusion',
  source: 'my-source',
  paint: {
    'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'min_height'],
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-opacity': 0.9,
  },
});
```

### Adding 3D Model Layer
```typescript
const threeLayer = new ThreeHouseLayer({
  glbUrl: '/House2.glb',
  features: modelPoints,
  onModelLoad: () => console.log('Loaded'),
  onMarkerClick: (id) => handleClick(id),
});
map.addLayer(threeLayer as any);
```

## Performance Checklist

- [x] GLB file size: 4.7KB (optimized)
- [ ] InstancedMesh: TODO (currently clones models)
- [ ] Spatial indexing: TODO (currently O(n²) collision detection)
- [ ] LOD models: TODO (system exists but not used)

## Key Files

| Purpose | File |
|---------|------|
| Fill Extrusion (Campaign) | `components/map/MapBuildingsLayer.tsx` |
| Fill Extrusion (2D Mode) | `components/map/BuildingLayers.tsx` (lines 431-528) |
| 3D Models (Custom Layer) | `components/map/ThreeHouseLayer.tsx` |
| 3D Models (Wrapper) | `components/map/BuildingLayers.tsx` (lines 530-705) |
| Main Map Component | `components/map/FlyrMapView.tsx` |

## Common Issues

### Models Not Appearing
1. Check WebGL support: `webglSupportedRef.current`
2. Verify model loaded: Check console for "✅ GLB model loaded"
3. Check coordinates: Ensure features have valid `geometry.coordinates`

### Performance Issues
1. Too many models: Consider fill-extrusion for 100+ buildings
2. Collision detection slow: Implement spatial indexing (rbush)
3. Initial load slow: Use InstancedMesh instead of cloning

### Orientation Wrong
1. Check `house_bearing` property in features
2. Verify bearing calculation in `MapService.ts`
3. Check rotation calculation in `ThreeHouseLayer.tsx` (line 400)
