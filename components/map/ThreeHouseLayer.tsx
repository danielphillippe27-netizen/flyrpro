'use client';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import type { BuildingModelPoint } from '@/lib/services/MapService';

interface ThreeHouseLayerOptions {
  glbUrl: string;
  features: BuildingModelPoint[];
  onModelLoad?: () => void;
  lodUrl?: string; // Low LOD model URL for performance
  useLOD?: boolean; // Whether to use LOD based on zoom level
}

interface ModelRecord {
  object: THREE.Object3D;
  feature: BuildingModelPoint;
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

  constructor(options: ThreeHouseLayerOptions) {
    this.id = 'three-houses';
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
    this.loader = new GLTFLoader();

    // Start loading the base model
    this.loadBaseModel();
    if (this.useLOD && this.lodUrl) {
      this.loadLODModel();
    }
  }

  private loadBaseModel() {
    this.loader.load(
      this.glbUrl,
      (gltf) => {
        this.baseModel = gltf.scene;
        if (this.map) {
          this.populateModels();
        }
        this.onModelLoad?.();
      },
      undefined,
      (error) => {
        console.error('Error loading GLB model:', error);
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

  private populateModels() {
    if (!this.baseModel || !this.map) return;

    // Clear existing models
    this.models.forEach((record) => {
      this.scene.remove(record.object);
    });
    this.models.clear();

    this.features.forEach((feature) => {
      const id = feature.properties.address_id;
      const { front_bearing = 0 } = feature.properties;
      const coords = feature.geometry.coordinates; // [lng, lat]

      // Convert to mercator
      const merc = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: coords[0], lat: coords[1] },
        0
      );

      // Clone model
      const modelClone = this.baseModel!.clone(true);

      // Apply color tint if color property exists
      const color = feature.properties.color || '#ffffff';
      modelClone.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material) {
          const hex = new THREE.Color(color);
          if (Array.isArray(node.material)) {
            node.material.forEach((m) => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.color.copy(hex);
                m.needsUpdate = true;
              }
            });
          } else if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.color.copy(hex);
            node.material.needsUpdate = true;
          }
        }
      });

      // Scale and position
      const scale = merc.metersPerUnit;
      const obj = new THREE.Object3D();
      obj.add(modelClone);

      // Set position using mercator to world coordinates
      obj.position.set(merc.x, merc.y, merc.z || 0);

      // Rotate to front_bearing (-bearing because of coordinate space)
      obj.rotation.z = (front_bearing * Math.PI) / 180 * -1;

      // Scale factor - adjust as needed for your model size
      // Typical house models are ~10-20m, so scale accordingly
      // For Monopoly-style houses, 0.5-1.0 works well
      const scaleFactor = scale * 0.5;
      obj.scale.setScalar(scaleFactor);
      
      // TODO: For hundreds of models, consider using THREE.InstancedMesh instead of cloning
      // This would significantly improve performance:
      // const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
      // instancedMesh.setMatrixAt(index, matrix);

      this.scene.add(obj);
      this.models.set(id, { object: obj, feature });
    });
  }

  onAdd(map: Map, gl: WebGLRenderingContext) {
    this.map = map;

    // Use Mapbox GL context - need to get the WebGL context from the map
    const canvas = map.getCanvas();
    const context = gl as WebGLRenderingContext;
    
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      context: context,
      antialias: true,
    });
    this.renderer.autoClear = false;

    // Add lighting
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(0, -70, 100).normalize();
    this.scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Try to populate models once base model is loaded
    if (this.baseModel) {
      this.populateModels();
    } else {
      // Poll until base model is loaded
      this.loadInterval = setInterval(() => {
        if (this.baseModel) {
          this.populateModels();
          if (this.loadInterval) {
            clearInterval(this.loadInterval);
            this.loadInterval = null;
          }
        }
      }, 200);
    }
  }

  render(gl: WebGLRenderingContext, matrix: number[]) {
    if (!this.renderer || !this.map) return;

    // Update LOD based on zoom if enabled
    if (this.useLOD) {
      this.updateLOD();
    }

    const m = new THREE.Matrix4().fromArray(matrix);
    this.camera.projectionMatrix = m;
    this.renderer.state.reset();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  onRemove() {
    if (this.loadInterval) {
      clearInterval(this.loadInterval);
      this.loadInterval = null;
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
  }

  // Update features (e.g., when campaign changes)
  updateFeatures(features: BuildingModelPoint[]) {
    this.features = features;
    if (this.map) {
      this.populateModels();
    }
  }

  // Update color for a specific house
  updateHouseColor(houseId: string, hex: string) {
    const record = this.models.get(houseId);
    if (!record) return;

    record.object.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material) {
        const color = new THREE.Color(hex);
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => {
            if (m instanceof THREE.MeshStandardMaterial) {
              m.color.copy(color);
              m.needsUpdate = true;
            }
          });
        } else if (node.material instanceof THREE.MeshStandardMaterial) {
          node.material.color.copy(color);
          node.material.needsUpdate = true;
        }
      }
    });

    // Update feature property
    record.feature.properties.color = hex;
  }
}

