'use client';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import type { BuildingModelPoint } from '@/lib/services/MapService';
import { MapService } from '@/lib/services/MapService';
import type { BuildingStatus } from '@/types/database';

interface ThreeHouseLayerOptions {
  glbUrl: string;
  features: BuildingModelPoint[];
  onModelLoad?: () => void;
  lodUrl?: string; // Low LOD model URL for performance
  useLOD?: boolean; // Whether to use LOD based on zoom level
  onMarkerClick?: (addressId: string) => void; // Callback when a marker is clicked
}

interface ModelRecord {
  object: THREE.Object3D;
  feature: BuildingModelPoint;
  isTownhouse?: boolean;
  unitIndex?: number;
}

export class ThreeHouseLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer | null = null;
  private baseModel: THREE.Group | null = null;
  private models: Map<string, ModelRecord>;
  private features: BuildingModelPoint[];
  private glbUrl: string;
  private lodUrl?: string;
  private useLOD: boolean;
  private loader: GLTFLoader;
  private map: Map | null = null;
  private onModelLoad?: () => void;
  private loadInterval: NodeJS.Timeout | null = null;
  private lodModel: THREE.Group | null = null;
  private currentZoom: number = 0;
  private lodThreshold: number = 15; // Switch to high LOD above this zoom
  private onMarkerClick?: (addressId: string) => void;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private shadowTexture: THREE.Texture | null = null;
  private directionalLight: THREE.DirectionalLight | null = null;

  /**
   * Get color hex code based on building status
   */
  private getStatusColor(status?: BuildingStatus | string): string {
    switch (status) {
      case 'interested':
        return '#10b981'; // Green
      case 'dnc':
        return '#ef4444'; // Red
      case 'not_home':
        return '#f97316'; // Orange
      case 'default':
      default:
        return '#6b7280'; // Grey
    }
  }

  constructor(options: ThreeHouseLayerOptions) {
    this.id = 'flyr-campaign-buildings-model-layer';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.models = new Map();
    this.features = options.features;
    this.glbUrl = options.glbUrl;
    this.lodUrl = options.lodUrl;
    this.useLOD = options.useLOD ?? false;
    this.onModelLoad = options.onModelLoad;
    this.onMarkerClick = options.onMarkerClick;
    this.loader = new GLTFLoader();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Start loading the base model
    this.loadBaseModel();
    if (this.useLOD && this.lodUrl) {
      this.loadLODModel();
    }
  }

  private loadBaseModel() {
    console.log('Loading GLB model from:', this.glbUrl);
    this.loader.load(
      this.glbUrl,
      (gltf) => {
        console.log('✅ GLB model loaded successfully');
        this.baseModel = gltf.scene;
        if (this.map) {
          console.log('Populating models on map...');
          this.populateModels();
        }
        this.onModelLoad?.();
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total) * 100;
          console.log(`Loading GLB: ${percent.toFixed(1)}%`);
        }
      },
      (error) => {
        console.error('❌ Error loading GLB model:', error);
      }
    );
  }

  private loadLODModel() {
    if (!this.lodUrl) return;
    
    this.loader.load(
      this.lodUrl,
      (gltf) => {
        this.lodModel = gltf.scene;
        // Update models if map is already loaded
        if (this.map) {
          this.updateLOD();
        }
      },
      undefined,
      (error) => {
        console.error('Error loading LOD model:', error);
      }
    );
  }

  private updateLOD() {
    if (!this.map || !this.useLOD) return;

    const zoom = this.map.getZoom();
    const shouldUseLOD = zoom < this.lodThreshold;
    
    if (zoom !== this.currentZoom) {
      this.currentZoom = zoom;
      // Re-populate with appropriate LOD
      if (shouldUseLOD && this.lodModel) {
        // Use LOD model
        const temp = this.baseModel;
        this.baseModel = this.lodModel;
        this.populateModels();
        this.baseModel = temp;
      } else if (!shouldUseLOD && this.baseModel) {
        // Use high detail model
        this.populateModels();
      }
    }
  }

  /**
   * Calculate the bounding box dimensions of a model
   * Returns width and depth (x and z dimensions) for shadow plane sizing
   */
  private calculateModelDimensions(model: THREE.Object3D): { width: number; depth: number } {
    const box = new THREE.Box3();
    box.setFromObject(model);
    
    const size = box.getSize(new THREE.Vector3());
    
    // Return width (x) and depth (z) dimensions
    return {
      width: size.x,
      depth: size.z,
    };
  }

  private populateModels() {
    if (!this.baseModel || !this.map) {
      console.warn('Cannot populate models: baseModel or map not available');
      return;
    }

    console.log(`Populating ${this.features.length} models...`);

    // Clear existing models
    this.models.forEach((record) => {
      this.scene.remove(record.object);
    });
    this.models.clear();

    this.features.forEach((feature, index) => {
      const id = feature.properties.address_id;
      // Use house_bearing from feature (already calculated in MapService with 90° rule)
      const bearing = feature.properties.house_bearing ?? feature.properties.front_bearing ?? 0;
      
      // NUCLEAR REWRITE: All coordinate math already done in MapService.ts using Turf.js
      // Coordinates are already in WGS84 with setback applied - just use them directly
      const coords = feature.geometry.coordinates; // [lng, lat] - already has setback applied

      // Apply visual offset if present (from collision detection)
      let finalCoords = coords;
      if (feature.properties.visual_offset) {
        finalCoords = [
          coords[0] + feature.properties.visual_offset[0],
          coords[1] + feature.properties.visual_offset[1],
        ];
      }

      // FINAL STEP: Convert WGS84 to Mercator (only at the very end)
      const finalMerc = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: finalCoords[0], lat: finalCoords[1] },
        0
      );

      // Clone model
      const modelClone = this.baseModel!.clone(true);

      // Apply color based on latest_status (Gold Standard: status-based coloring)
      // Priority: latest_status > color property > default grey
      const status = feature.properties.latest_status as BuildingStatus | undefined;
      const colorHex = status 
        ? this.getStatusColor(status)
        : (feature.properties.color || this.getStatusColor('default'));
      
      modelClone.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material) {
          const hex = new THREE.Color(colorHex);
          if (Array.isArray(node.material)) {
            node.material.forEach((m) => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.color.copy(hex);
                m.roughness = 0.8;
                m.metalness = 0.1;
                m.needsUpdate = true;
              }
            });
          } else if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.color.copy(hex);
            node.material.roughness = 0.8;
            node.material.metalness = 0.1;
            node.material.needsUpdate = true;
          }
        }
      });

      // Create object group - house origin at bottom-center
      const obj = new THREE.Object3D();
      obj.add(modelClone);

      // Set position using mercator to world coordinates
      // Mercator coordinates are already in world space for Mapbox
      obj.position.set(finalMerc.x, finalMerc.y, finalMerc.z || 0);

      // 🔥 FIX: Lift it slightly on the Z-axis (Mapbox Z is Up)
      // Try 5 meters (converted to Mercator scale roughly) to ensure it pops out
      obj.position.z += 0.000005;

      // Rotation: Fix orientation first, then apply bearing
      // If model is on its side, rotate 90 degrees on X axis to stand it upright
      obj.rotation.x = Math.PI / 2; // Rotate +90 degrees on X axis to stand upright
      
      // Rotate to bearing around Z axis (compass direction)
      // house_bearing is already calculated with vector-based orientation in BuildingService
      // Note: bearing is in degrees, convert to radians
      // Z-axis rotation: negative because Three.js uses left-handed coordinate system
      obj.rotation.z = (bearing * Math.PI) / 180 * -1;
      
      // Gold Standard: Ensure Z-axis grounding - model pivot is at bottom-center
      // The model should already be positioned with bottom at z=0, but we ensure it here
      // Position is set below, and the model's origin should be at bottom-center

      // 🔥 SMART SCALE: Calculate scale dynamically based on latitude
      // This ensures houses are the same size in meters regardless of location (Toronto, Florida, Alaska, etc.)
      // DEBUG: If houses are invisible, temporarily set baseScaleFactor to 0.00002000 (100x bigger) to verify they exist
      // 1. Calculate how many "Mercator Units" equal 1 Meter at this latitude
      const metersPerPixel = finalMerc.meterInMercatorCoordinateUnits();
      
      // 2. Decide how big the house should be (e.g., 8 meters wide)
      const targetSizeMeters = 8;
      
      // 3. Set the base scale dynamically
      const baseScaleFactor = metersPerPixel * targetSizeMeters;

      // Apply dynamic scale factor from properties (already calculated with 70% rule in BuildingService)
      const dynamicScale = feature.properties.scale_factor ?? 1.0;
      // Apply collision scale reduction if present (from iterative collision resolution)
      const collisionScaleReduction = feature.properties.collision_scale_reduction ?? 1.0;
      
      // Collision fail-safe: Use townhouse model if width < 4m
      const widthMeters = feature.properties.width_meters ?? 10;
      const isTownhouse = (feature.properties.is_townhouse ?? false) || widthMeters < 4;

      // Calculate the final scale factor for use in shadow sizing
      // This ensures scaleFactor is always defined and accessible
      const scaleFactor = baseScaleFactor * dynamicScale * collisionScaleReduction;

      // Apply scaling: for townhouses, use narrower width (0.4x) and taller height (1.5x)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ThreeHouseLayer.tsx:253',message:'Before scaling - scale values',data:{index,baseScaleFactor,dynamicScale,isTownhouse},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (isTownhouse) {
        // Townhouse: width based on neighborDistance, depth increased by 1.2x, taller height
        // Width scaling is already in dynamicScale (calculated from neighborDistance)
        const townhouseScaleX = baseScaleFactor * dynamicScale;
        const townhouseScaleY = baseScaleFactor * dynamicScale * 1.2; // Increase depth by 1.2x for narrow, deep units
        const townhouseScaleZ = baseScaleFactor * dynamicScale * 1.5;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ThreeHouseLayer.tsx:256',message:'Townhouse scaling applied',data:{index,scaleX:townhouseScaleX,scaleY:townhouseScaleY,scaleZ:townhouseScaleZ},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        obj.scale.set(
          townhouseScaleX, // Narrower width
          townhouseScaleY,        // Normal depth
          townhouseScaleZ   // Taller height
        );
      } else {
        // Standard house: uniform scaling with dynamic factor
        const finalScale = baseScaleFactor * dynamicScale;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ThreeHouseLayer.tsx:262',message:'Standard house scaling applied',data:{index,finalScale},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        obj.scale.setScalar(finalScale);
      }
      
      // #region agent log
      const computedScale = baseScaleFactor * dynamicScale;
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ThreeHouseLayer.tsx:275',message:'Before log statement - computed scale values',data:{index,computedScale,baseScaleFactor,dynamicScale,isTownhouse},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (index === 0) {
        console.log(`First model at [${finalCoords[0]}, ${finalCoords[1]}], mercator: [${finalMerc.x}, ${finalMerc.y}], scale: ${scaleFactor}, bearing: ${bearing}`);
      }
      
      if (index < 5) {
        console.log(`Model ${index} at [${finalCoords[0]}, ${finalCoords[1]}], mercator: [${finalMerc.x}, ${finalMerc.y}]`);
      }
      
      // Create contact shadow plane
      if (this.shadowTexture) {
        // Calculate model dimensions for shadow sizing
        const dimensions = this.calculateModelDimensions(modelClone);
        const shadowSize = Math.max(dimensions.width, dimensions.depth) * 1.2; // 1.2x the larger dimension
        
        // Create shadow plane geometry
        const shadowGeometry = new THREE.PlaneGeometry(shadowSize, shadowSize);
        
        // Create shadow material
        const shadowMaterial = new THREE.MeshBasicMaterial({
          map: this.shadowTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0.4,
          blending: THREE.MultiplyBlending,
          premultipliedAlpha: true,
        });
        
        // Create shadow mesh
        const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
        
        // Position shadow plane just above ground (y: 0.01 in model space)
        // Rotate -90 degrees on X-axis to lay flat
        shadowMesh.position.set(0, 0.01, 0);
        shadowMesh.rotation.x = -Math.PI / 2;
        
        // Add shadow as child of house model group so it inherits transformations
        obj.add(shadowMesh);
      }
      
      // TODO: For hundreds of models, consider using THREE.InstancedMesh instead of cloning
      // This would significantly improve performance:
      // const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
      // instancedMesh.setMatrixAt(index, matrix);

      this.scene.add(obj);
      
      // Store townhouse metadata for UI feedback
      const unitIndex = feature.properties.townhouse_unit_index;
      
      this.models.set(id, { 
        object: obj, 
        feature,
        isTownhouse, // Reuse variable defined earlier
        unitIndex,
      });
    });

    // Apply collision detection and resolution
    this.detectAndResolveCollisions();

    console.log(`✅ Added ${this.models.size} models to scene`);
  }

  /**
   * Calculate bounding box for a Three.js object in world space
   */
  private calculateBoundingBox(object: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3();
    box.setFromObject(object);
    return box;
  }

  /**
   * Detect and resolve collisions by iteratively reducing scale
   * NUCLEAR REWRITE: Prioritize shrinking over nudging (nudging moves houses into the street)
   * Priority: 1) Reduce scale by 10% iteratively, 2) Only nudge as last resort if scale can't be reduced further
   */
  private detectAndResolveCollisions() {
    if (this.models.size < 2) return;

    const modelArray = Array.from(this.models.values());
    const maxIterations = 10;
    let iteration = 0;
    let hasCollisions = true;

    while (hasCollisions && iteration < maxIterations) {
      hasCollisions = false;
      iteration++;

      for (let i = 0; i < modelArray.length; i++) {
        for (let j = i + 1; j < modelArray.length; j++) {
          const recordA = modelArray[i];
          const recordB = modelArray[j];

          // Calculate bounding boxes
          const boxA = this.calculateBoundingBox(recordA.object);
          const boxB = this.calculateBoundingBox(recordB.object);

          // Check for intersection
          if (boxA.intersectsBox(boxB)) {
            hasCollisions = true;

            // Priority 1: ALWAYS try reducing scale first (shrinking is preferred over nudging)
            const currentReductionA = recordA.feature.properties.collision_scale_reduction ?? 1.0;
            const currentReductionB = recordB.feature.properties.collision_scale_reduction ?? 1.0;
            const minReduction = 0.5; // Don't reduce below 50% of original size

            if (currentReductionA > minReduction || currentReductionB > minReduction) {
              // Reduce scale of both models by 10%
              const newReductionA = Math.max(minReduction, currentReductionA * 0.9);
              const newReductionB = Math.max(minReduction, currentReductionB * 0.9);

              recordA.feature.properties.collision_scale_reduction = newReductionA;
              recordB.feature.properties.collision_scale_reduction = newReductionB;

              // Reapply scaling to both models (shadow scales automatically as child)
              this.reapplyScaling(recordA);
              this.reapplyScaling(recordB);
            } else {
              // Priority 2: LAST RESORT - Only nudge if scale can't be reduced further
              // (Nudging moves houses into the street, so we minimize this)
              // Get road bearing from feature (use house_bearing as proxy for road direction)
              const bearingA = recordA.feature.properties.house_bearing ?? recordA.feature.properties.front_bearing ?? 0;
              const bearingB = recordB.feature.properties.house_bearing ?? recordB.feature.properties.front_bearing ?? 0;
              const avgBearing = (bearingA + bearingB) / 2;

              // Calculate road vector (perpendicular to house bearing)
              const bearingRad = ((avgBearing + 90) * Math.PI) / 180; // Road is perpendicular to house
              const roadVector = {
                x: Math.cos(bearingRad),
                y: Math.sin(bearingRad),
              };

              // Calculate nudge distance (small offset in mercator space)
              // Convert ~1 meter to mercator units (approximate)
              const nudgeDistance = 0.00001; // Small nudge in mercator space

              // Get current visual offsets
              const offsetA = recordA.feature.properties.visual_offset || [0, 0];
              const offsetB = recordB.feature.properties.visual_offset || [0, 0];

              // Nudge A "up" the road, B "down" the road
              const newOffsetA: [number, number] = [
                offsetA[0] + roadVector.x * nudgeDistance,
                offsetA[1] + roadVector.y * nudgeDistance,
              ];
              const newOffsetB: [number, number] = [
                offsetB[0] - roadVector.x * nudgeDistance,
                offsetB[1] - roadVector.y * nudgeDistance,
              ];

              // Update feature properties
              recordA.feature.properties.visual_offset = newOffsetA;
              recordB.feature.properties.visual_offset = newOffsetB;

              // Recalculate positions
              const coordsA = recordA.feature.geometry.coordinates;
              const finalCoordsA: [number, number] = [
                coordsA[0] + newOffsetA[0],
                coordsA[1] + newOffsetA[1],
              ];
              const mercA = mapboxgl.MercatorCoordinate.fromLngLat(
                { lng: finalCoordsA[0], lat: finalCoordsA[1] },
                0
              );
              recordA.object.position.set(mercA.x, mercA.y, mercA.z || 0);

              const coordsB = recordB.feature.geometry.coordinates;
              const finalCoordsB: [number, number] = [
                coordsB[0] + newOffsetB[0],
                coordsB[1] + newOffsetB[1],
              ];
              const mercB = mapboxgl.MercatorCoordinate.fromLngLat(
                { lng: finalCoordsB[0], lat: finalCoordsB[1] },
                0
              );
              recordB.object.position.set(mercB.x, mercB.y, mercB.z || 0);
            }
          }
        }
      }
    }

    if (iteration >= maxIterations && hasCollisions) {
      console.warn('Collision resolution reached max iterations, some overlaps may remain');
    }
  }

  /**
   * Reapply scaling to a model record after collision scale reduction
   */
  private reapplyScaling(record: ModelRecord) {
    const feature = record.feature;
    const obj = record.object;
    const bearing = feature.properties.house_bearing ?? feature.properties.front_bearing ?? 0;
    
    // Calculate dynamic scale based on latitude (same as in populateModels)
    const coords = feature.geometry.coordinates;
    const finalMerc = mapboxgl.MercatorCoordinate.fromLngLat(
      { lng: coords[0], lat: coords[1] },
      0
    );
    const metersPerPixel = finalMerc.meterInMercatorCoordinateUnits();
    const targetSizeMeters = 8;
    const baseScaleFactor = metersPerPixel * targetSizeMeters;
    
    const dynamicScale = feature.properties.scale_factor ?? 1.0;
    const collisionScaleReduction = feature.properties.collision_scale_reduction ?? 1.0;
    const isTownhouse = feature.properties.is_townhouse ?? false;

    if (isTownhouse) {
      // Townhouse: width based on neighborDistance, depth increased by 1.2x, taller height
      const townhouseScaleX = baseScaleFactor * dynamicScale * collisionScaleReduction;
      const townhouseScaleY = baseScaleFactor * dynamicScale * collisionScaleReduction * 1.2;
      const townhouseScaleZ = baseScaleFactor * dynamicScale * collisionScaleReduction * 1.5;
      obj.scale.set(townhouseScaleX, townhouseScaleY, townhouseScaleZ);
    } else {
      // Standard house: uniform scaling with dynamic factor and collision reduction
      const finalScale = baseScaleFactor * dynamicScale * collisionScaleReduction;
      obj.scale.setScalar(finalScale);
    }
  }

  onAdd(map: Map, gl: WebGLRenderingContext) {
    console.log('ThreeHouseLayer.onAdd called');
    this.map = map;

    // Use Mapbox GL context - need to get the WebGL context from the map
    const canvas = map.getCanvas();
    const context = gl as WebGLRenderingContext;
    
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        context: context,
        antialias: true,
      });
      this.renderer.autoClear = false;
      console.log('✅ Three.js renderer created');
    } catch (error) {
      console.error('❌ Error creating Three.js renderer:', error);
      throw error;
    }

    // Add ambient light for base illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    // Add directional light (will be configured based on house_bearing in populateModels)
    // Default position for now, will be updated per building
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.directionalLight.position.set(0, -70, 100).normalize();
    this.directionalLight.castShadow = false; // Shadows disabled for performance
    this.scene.add(this.directionalLight);
    console.log('✅ Lighting added to scene');

    // Create shadow texture for contact shadows
    try {
      this.shadowTexture = MapService.createShadowTexture(256);
      console.log('✅ Shadow texture created');
    } catch (error) {
      console.error('❌ Error creating shadow texture:', error);
    }

    // Add click handler for marker selection
    if (this.onMarkerClick) {
      map.on('click', this.handleMapClick.bind(this));
    }

    // Try to populate models once base model is loaded
    if (this.baseModel) {
      console.log('Base model already loaded, populating models...');
      this.populateModels();
    } else {
      console.log('Base model not loaded yet, polling...');
      // Poll until base model is loaded
      this.loadInterval = setInterval(() => {
        if (this.baseModel) {
          console.log('Base model loaded, populating models...');
          this.populateModels();
          if (this.loadInterval) {
            clearInterval(this.loadInterval);
            this.loadInterval = null;
          }
        }
      }, 200);
    }
  }

  private handleMapClick(e: mapboxgl.MapMouseEvent) {
    if (!this.onMarkerClick || !this.map || !this.renderer) return;

    const canvas = this.map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    
    // Convert mouse position to normalized device coordinates
    this.mouse.x = ((e.point.x - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.point.y - rect.top) / rect.height) * 2 + 1;

    // Update raycaster with camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Find intersected objects
    const intersects = this.raycaster.intersectObjects(Array.from(this.models.values()).map(r => r.object), true);

    if (intersects.length > 0) {
      // Find which model was clicked
      const clickedObject = intersects[0].object;
      
      // Traverse up to find the root object
      let rootObject = clickedObject;
      while (rootObject.parent && rootObject.parent !== this.scene) {
        rootObject = rootObject.parent;
      }

      // Find the model record
      for (const [addressId, record] of this.models.entries()) {
        if (record.object === rootObject || record.object.children.includes(rootObject)) {
          this.onMarkerClick(addressId);
          break;
        }
      }
    }
  }

  render(gl: WebGLRenderingContext, matrix: number[]) {
    if (!this.renderer || !this.map) {
      return;
    }

    // Update LOD based on zoom if enabled
    if (this.useLOD) {
      this.updateLOD();
    }

    try {
      const m = new THREE.Matrix4().fromArray(matrix);
      this.camera.projectionMatrix = m;
      this.renderer.state.reset();
      this.renderer.render(this.scene, this.camera);
      this.renderer.resetState();
      
      // 🔥 CRITICAL: Trigger repaint so Mapbox keeps rendering this layer
      // Without this, the layer renders once and then disappears
      this.map.triggerRepaint();
    } catch (error) {
      console.error('Error rendering Three.js scene:', error);
    }
  }

  onRemove() {
    if (this.loadInterval) {
      clearInterval(this.loadInterval);
      this.loadInterval = null;
    }

    // Remove click handler
    if (this.map && this.onMarkerClick) {
      this.map.off('click', this.handleMapClick);
    }

    // Clean up models
    this.models.forEach((record) => {
      this.scene.remove(record.object);
      // Dispose of geometries and materials
      record.object.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            if (Array.isArray(node.material)) {
              node.material.forEach((m) => m.dispose());
            } else {
              node.material.dispose();
            }
          }
        }
      });
    });
    this.models.clear();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    // Dispose shadow texture
    if (this.shadowTexture) {
      this.shadowTexture.dispose();
      this.shadowTexture = null;
    }
  }

  // Update features (e.g., when campaign changes)
  updateFeatures(features: BuildingModelPoint[]) {
    this.features = features;
    if (this.map) {
      this.populateModels();
    }
  }

  // Update color for a specific house with animation
  updateHouseColor(houseId: string, hex: string, animate: boolean = true) {
    const record = this.models.get(houseId);
    if (!record) return;

    const targetColor = new THREE.Color(hex);
    const obj = record.object;

    if (animate) {
      // Animate scale: scale up 1.2x then back to 1.0x
      const originalScale = obj.scale.clone();
      const targetScale = originalScale.multiplyScalar(1.2);
      
      // Scale up animation
      const scaleUp = () => {
        const startTime = Date.now();
        const duration = 200; // 200ms
        
        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          
          // Ease out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          obj.scale.lerpVectors(originalScale, targetScale, eased);
          
          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            // Scale down animation
            const scaleDown = () => {
              const startTime = Date.now();
              const duration = 200;
              
              const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                obj.scale.lerpVectors(targetScale, originalScale, eased);
                
                if (progress < 1) {
                  requestAnimationFrame(animate);
                }
              };
              animate();
            };
            scaleDown();
          }
        };
        animate();
      };
      
      scaleUp();
    }

    // Update color
    record.object.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => {
            if (m instanceof THREE.MeshStandardMaterial) {
              m.color.copy(targetColor);
              m.needsUpdate = true;
            }
          });
        } else if (node.material instanceof THREE.MeshStandardMaterial) {
          node.material.color.copy(targetColor);
          node.material.needsUpdate = true;
        }
      }
    });

    // Update feature property
    record.feature.properties.color = hex;
    record.feature.properties.latest_status = hex; // Update status for color mapping
  }

  // Collision fail-safe: Replace model with townhouse if width < 4m
  private shouldUseTownhouseModel(feature: BuildingModelPoint): boolean {
    const widthMeters = feature.properties.width_meters || 10;
    return widthMeters < 4; // Use townhouse model for narrow buildings
  }

  /**
   * Animate a new building into the scene
   * Used for real-time provisioning: buildings pop in with scale-up and fade-in animation
   */
  async animateBuildingIn(building: import('@/types/database').Building) {
    if (!this.baseModel || !this.map) return;

    try {
      // Convert building to BuildingModelPoint
      const modelPoints = await MapService.createBuildingModelPointsFromBuildings([building]);
      if (modelPoints.length === 0) return;

      const feature = modelPoints[0];
      
      // Create model using existing logic
      const coords = feature.geometry.coordinates;
      const bearing = feature.properties.house_bearing || 0;
      
      // Convert to Mercator
      const finalMerc = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: coords[0], lat: coords[1] },
        0
      );

      // Clone model
      const modelClone = this.baseModel.clone(true);

      // Apply color based on status
      const status = feature.properties.latest_status as BuildingStatus | undefined;
      const colorHex = status 
        ? this.getStatusColor(status)
        : this.getStatusColor('default');
      
      modelClone.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material) {
          const hex = new THREE.Color(colorHex);
          if (Array.isArray(node.material)) {
            node.material.forEach((m) => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.color.copy(hex);
                m.roughness = 0.8;
                m.metalness = 0.1;
                m.transparent = true;
                m.opacity = 0; // Start invisible
                m.needsUpdate = true;
              }
            });
          } else if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.color.copy(hex);
            node.material.roughness = 0.8;
            node.material.metalness = 0.1;
            node.material.transparent = true;
            node.material.opacity = 0; // Start invisible
            node.material.needsUpdate = true;
          }
        }
      });

      // Create object group
      const obj = new THREE.Object3D();
      obj.add(modelClone);
      obj.position.set(finalMerc.x, finalMerc.y, finalMerc.z || 0);

      // 🔥 FIX: Lift it slightly on the Z-axis (Mapbox Z is Up)
      obj.position.z += 0.000005;

      obj.rotation.x = Math.PI / 2;
      obj.rotation.z = (bearing * Math.PI) / 180 * -1;

      // 🔥 SMART SCALE: Calculate scale dynamically based on latitude (same as populateModels)
      const metersPerPixel = finalMerc.meterInMercatorCoordinateUnits();
      const targetSizeMeters = 8;
      const baseScaleFactor = metersPerPixel * targetSizeMeters;
      const dynamicScale = feature.properties.scale_factor ?? 1.0;
      const scaleFactor = baseScaleFactor * dynamicScale;
      obj.scale.set(0, 0, 0); // Start at scale 0

      // Add to scene
      this.scene.add(obj);
      this.models.set(feature.properties.building_id || building.id, {
        object: obj,
        feature,
      });

      // Animate: scale up and fade in over 500ms
      const duration = 500;
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-out cubic curve
        const eased = 1 - Math.pow(1 - progress, 3);
        
        // Scale from 0 to target
        obj.scale.set(
          scaleFactor * eased,
          scaleFactor * eased,
          scaleFactor * eased
        );
        
        // Fade in opacity
        modelClone.traverse((node) => {
          if (node instanceof THREE.Mesh && node.material) {
            if (Array.isArray(node.material)) {
              node.material.forEach((m) => {
                if (m instanceof THREE.MeshStandardMaterial && m.transparent) {
                  m.opacity = eased;
                }
              });
            } else if (node.material instanceof THREE.MeshStandardMaterial && node.material.transparent) {
              node.material.opacity = eased;
            }
          }
        });
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation complete - make materials non-transparent for performance
          modelClone.traverse((node) => {
            if (node instanceof THREE.Mesh && node.material) {
              if (Array.isArray(node.material)) {
                node.material.forEach((m) => {
                  if (m instanceof THREE.MeshStandardMaterial) {
                    m.transparent = false;
                    m.opacity = 1;
                  }
                });
              } else if (node.material instanceof THREE.MeshStandardMaterial) {
                node.material.transparent = false;
                node.material.opacity = 1;
              }
            }
          });
        }
      };
      
      animate();
    } catch (error) {
      console.error('Error animating building in:', error);
    }
  }
}

