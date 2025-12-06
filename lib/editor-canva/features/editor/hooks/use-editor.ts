import { fabric } from "fabric";
import { useCallback, useState, useMemo, useRef, useEffect } from "react";

import { 
  Editor, 
  FILL_COLOR,
  STROKE_WIDTH,
  STROKE_COLOR,
  CIRCLE_OPTIONS,
  DIAMOND_OPTIONS,
  TRIANGLE_OPTIONS,
  BuildEditorProps, 
  RECTANGLE_OPTIONS,
  EditorHookProps,
  STROKE_DASH_ARRAY,
  TEXT_OPTIONS,
  FONT_FAMILY,
  FONT_WEIGHT,
  FONT_SIZE,
  JSON_KEYS,
} from "@/lib/editor-canva/features/editor/types";
import { useHistory } from "@/lib/editor-canva/features/editor/hooks/use-history";
import { 
  createFilter, 
  downloadFile, 
  isTextType,
  transformText
} from "@/lib/editor-canva/features/editor/utils";
import { useHotkeys } from "@/lib/editor-canva/features/editor/hooks/use-hotkeys";
import { useClipboard } from "@/lib/editor-canva/features/editor/hooks//use-clipboard";
import { useAutoResize } from "@/lib/editor-canva/features/editor/hooks/use-auto-resize";
import { useCanvasEvents } from "@/lib/editor-canva/features/editor/hooks/use-canvas-events";
import { useWindowEvents } from "@/lib/editor-canva/features/editor/hooks/use-window-events";
import { useLoadState } from "@/lib/editor-canva/features/editor/hooks/use-load-state";
import { useBleedOverlay } from "@/lib/editor-canva/features/editor/hooks/use-bleed-overlay";
import { useSnapToTrim } from "@/lib/editor-canva/features/editor/hooks/use-snap-to-trim";
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from "@/lib/flyers/printConstants";

const buildEditor = ({
  save,
  undo,
  redo,
  canRedo,
  canUndo,
  autoZoom,
  copy,
  paste,
  canvas,
  fillColor,
  fontFamily,
  setFontFamily,
  setFillColor,
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  selectedObjects,
  strokeDashArray,
  setStrokeDashArray,
  showBleed,
  showSafeZone,
  setShowBleed,
  setShowSafeZone,
  zoom,
  setZoom,
}: BuildEditorProps): Editor => {
  const generateSaveOptions = () => {
    const workspace = getWorkspace() as fabric.Rect;
    if (!workspace) {
      return {
        name: "Image",
        format: "png",
        quality: 1,
        width: 0,
        height: 0,
        left: 0,
        top: 0,
      };
    }

    const { TRIM_WIDTH, TRIM_HEIGHT, BLEED_WIDTH, BLEED_HEIGHT, BLEED_INSET } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

    // If showBleed is true, export full bleed size, otherwise export trim size
    const exportWidth = showBleed ? BLEED_WIDTH : TRIM_WIDTH;
    const exportHeight = showBleed ? BLEED_HEIGHT : TRIM_HEIGHT;
    
    // Calculate export area
    // If exporting trim, we need to crop from the bleed workspace
    const workspaceLeft = workspace.left || 0;
    const workspaceTop = workspace.top || 0;
    const exportLeft = showBleed ? workspaceLeft : workspaceLeft + BLEED_INSET;
    const exportTop = showBleed ? workspaceTop : workspaceTop + BLEED_INSET;

    return {
      name: "Image",
      format: "png",
      quality: 1,
      width: exportWidth,
      height: exportHeight,
      left: exportLeft,
      top: exportTop,
    };
  };

  const savePng = () => {
    // Hide overlay objects before export
    const overlayObjects = canvas.getObjects().filter((obj: fabric.Object) => {
      const name = obj.name || "";
      return name.includes("bleed-zone") || name.includes("crop-mark") || name.includes("safe-zone");
    });
    
    overlayObjects.forEach((obj) => {
      obj.visible = false;
    });
    canvas.renderAll();

    const options = generateSaveOptions();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const dataUrl = canvas.toDataURL(options);

    // Restore overlay visibility
    overlayObjects.forEach((obj) => {
      obj.visible = true;
    });
    canvas.renderAll();

    downloadFile(dataUrl, "png");
    autoZoom();
  };

  const saveSvg = () => {
    // Hide overlay objects before export
    const overlayObjects = canvas.getObjects().filter((obj: fabric.Object) => {
      const name = obj.name || "";
      return name.includes("bleed-zone") || name.includes("crop-mark") || name.includes("safe-zone");
    });
    
    overlayObjects.forEach((obj) => {
      obj.visible = false;
    });
    canvas.renderAll();

    const options = generateSaveOptions();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const dataUrl = canvas.toDataURL(options);

    // Restore overlay visibility
    overlayObjects.forEach((obj) => {
      obj.visible = true;
    });
    canvas.renderAll();

    downloadFile(dataUrl, "svg");
    autoZoom();
  };

  const saveJpg = () => {
    // Hide overlay objects before export
    const overlayObjects = canvas.getObjects().filter((obj: fabric.Object) => {
      const name = obj.name || "";
      return name.includes("bleed-zone") || name.includes("crop-mark") || name.includes("safe-zone");
    });
    
    overlayObjects.forEach((obj) => {
      obj.visible = false;
    });
    canvas.renderAll();

    const options = generateSaveOptions();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const dataUrl = canvas.toDataURL(options);

    // Restore overlay visibility
    overlayObjects.forEach((obj) => {
      obj.visible = true;
    });
    canvas.renderAll();

    downloadFile(dataUrl, "jpg");
    autoZoom();
  };

  const saveJson = async () => {
    const dataUrl = canvas.toJSON(JSON_KEYS);

    await transformText(dataUrl.objects);
    const fileString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(dataUrl, null, "\t"),
    )}`;
    downloadFile(fileString, "json");
  };

  const loadJson = (json: string) => {
    const data = JSON.parse(json);

    canvas.loadFromJSON(data, () => {
      autoZoom();
    });
  };

  const getWorkspace = () => {
    return canvas
    .getObjects()
    .find((object) => object.name === "clip");
  };

  const center = (object: fabric.Object) => {
    const workspace = getWorkspace();
    const center = workspace?.getCenterPoint();

    if (!center) return;

    // @ts-ignore
    canvas._centerObject(object, center);
  };

  const addToCanvas = (object: fabric.Object) => {
    center(object);
    canvas.add(object);
    canvas.setActiveObject(object);
  };

  return {
    savePng,
    saveJpg,
    saveSvg,
    saveJson,
    loadJson,
    canUndo,
    canRedo,
    autoZoom,
    getWorkspace,
    getZoom: () => {
      return canvas.getZoom();
    },
    setZoom: (value: number) => {
      const clampedValue = Math.max(0.1, Math.min(4, value));
      const center = canvas.getCenter();
      canvas.zoomToPoint(
        new fabric.Point(center.left, center.top),
        clampedValue
      );
      setZoom(clampedValue);
    },
    zoomIn: () => {
      let zoomRatio = canvas.getZoom();
      zoomRatio += 0.05;
      const center = canvas.getCenter();
      const newZoom = zoomRatio > 1 ? 1 : zoomRatio;
      canvas.zoomToPoint(
        new fabric.Point(center.left, center.top),
        newZoom
      );
      setZoom(newZoom);
    },
    zoomOut: () => {
      let zoomRatio = canvas.getZoom();
      zoomRatio -= 0.05;
      const center = canvas.getCenter();
      const newZoom = zoomRatio < 0.2 ? 0.2 : zoomRatio;
      canvas.zoomToPoint(
        new fabric.Point(center.left, center.top),
        newZoom,
      );
      setZoom(newZoom);
    },
    changeSize: (value: { width: number; height: number }) => {
      const workspace = getWorkspace();

      workspace?.set(value);
      autoZoom();
      save();
    },
    changeBackground: (value: string) => {
      const workspace = getWorkspace();
      if (!workspace) {
        console.warn("Workspace not found, cannot change background");
        return;
      }
      // Set the fill color
      workspace.set({ fill: value });
      // Ensure workspace is at the back (lowest z-index) so it appears as background
      canvas.sendToBack(workspace);
      // Force a re-render to show the background change
      canvas.requestRenderAll();
      save();
    },
    enableDrawingMode: () => {
      canvas.discardActiveObject();
      canvas.renderAll();
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.width = strokeWidth;
      canvas.freeDrawingBrush.color = strokeColor;
    },
    disableDrawingMode: () => {
      canvas.isDrawingMode = false;
    },
    onUndo: () => undo(),
    onRedo: () => redo(),
    onCopy: () => copy(),
    onPaste: () => paste(),
    changeImageFilter: (value: string) => {
      const objects = canvas.getActiveObjects();
      objects.forEach((object) => {
        if (object.type === "image") {
          const imageObject = object as fabric.Image;

          const effect = createFilter(value);

          imageObject.filters = effect ? [effect] : [];
          imageObject.applyFilters();
          canvas.renderAll();
        }
      });
    },
    addImage: (value: string) => {
      fabric.Image.fromURL(
        value,
        (image) => {
          const workspace = getWorkspace();

          image.scaleToWidth(workspace?.width || 0);
          image.scaleToHeight(workspace?.height || 0);

          addToCanvas(image);
        },
        {
          crossOrigin: "anonymous",
        },
      );
    },
    delete: () => {
      canvas.getActiveObjects().forEach((object) => canvas.remove(object));
      canvas.discardActiveObject();
      canvas.renderAll();
    },
    addText: (value, options) => {
      const object = new fabric.Textbox(value, {
        ...TEXT_OPTIONS,
        fill: fillColor,
        ...options,
      });

      addToCanvas(object);
    },
    getActiveOpacity: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return 1;
      }

      const value = selectedObject.get("opacity") || 1;

      return value;
    },
    changeFontSize: (value: number) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, fontSize exists.
          object.set({ fontSize: value });
        }
      });
      canvas.renderAll();
    },
    getActiveFontSize: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return FONT_SIZE;
      }

      // @ts-ignore
      // Faulty TS library, fontSize exists.
      const value = selectedObject.get("fontSize") || FONT_SIZE;

      return value;
    },
    changeTextAlign: (value: string) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, textAlign exists.
          object.set({ textAlign: value });
        }
      });
      canvas.renderAll();
    },
    getActiveTextAlign: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return "left";
      }

      // @ts-ignore
      // Faulty TS library, textAlign exists.
      const value = selectedObject.get("textAlign") || "left";

      return value;
    },
    changeFontUnderline: (value: boolean) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, underline exists.
          object.set({ underline: value });
        }
      });
      canvas.renderAll();
    },
    getActiveFontUnderline: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return false;
      }

      // @ts-ignore
      // Faulty TS library, underline exists.
      const value = selectedObject.get("underline") || false;

      return value;
    },
    changeFontLinethrough: (value: boolean) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, linethrough exists.
          object.set({ linethrough: value });
        }
      });
      canvas.renderAll();
    },
    getActiveFontLinethrough: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return false;
      }

      // @ts-ignore
      // Faulty TS library, linethrough exists.
      const value = selectedObject.get("linethrough") || false;

      return value;
    },
    changeFontStyle: (value: string) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, fontStyle exists.
          object.set({ fontStyle: value });
        }
      });
      canvas.renderAll();
    },
    getActiveFontStyle: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return "normal";
      }

      // @ts-ignore
      // Faulty TS library, fontStyle exists.
      const value = selectedObject.get("fontStyle") || "normal";

      return value;
    },
    changeFontWeight: (value: number) => {
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, fontWeight exists.
          object.set({ fontWeight: value });
        }
      });
      canvas.renderAll();
    },
    changeOpacity: (value: number) => {
      canvas.getActiveObjects().forEach((object) => {
        object.set({ opacity: value });
      });
      canvas.renderAll();
    },
    bringForward: () => {
      canvas.getActiveObjects().forEach((object) => {
        canvas.bringForward(object);
      });

      canvas.renderAll();
      
      const workspace = getWorkspace();
      workspace?.sendToBack();
    },
    sendBackwards: () => {
      canvas.getActiveObjects().forEach((object) => {
        canvas.sendBackwards(object);
      });

      canvas.renderAll();
      const workspace = getWorkspace();
      workspace?.sendToBack();
    },
    changeFontFamily: (value: string) => {
      setFontFamily(value);
      canvas.getActiveObjects().forEach((object) => {
        if (isTextType(object.type)) {
          // @ts-ignore
          // Faulty TS library, fontFamily exists.
          object.set({ fontFamily: value });
        }
      });
      canvas.renderAll();
    },
    changeFillColor: (value: string) => {
      setFillColor(value);
      canvas.getActiveObjects().forEach((object) => {
        object.set({ fill: value });
      });
      canvas.renderAll();
    },
    changeStrokeColor: (value: string) => {
      setStrokeColor(value);
      canvas.getActiveObjects().forEach((object) => {
        // Text types don't have stroke
        if (isTextType(object.type)) {
          object.set({ fill: value });
          return;
        }

        object.set({ stroke: value });
      });
      canvas.freeDrawingBrush.color = value;
      canvas.renderAll();
    },
    changeStrokeWidth: (value: number) => {
      setStrokeWidth(value);
      canvas.getActiveObjects().forEach((object) => {
        object.set({ strokeWidth: value });
      });
      canvas.freeDrawingBrush.width = value;
      canvas.renderAll();
    },
    changeStrokeDashArray: (value: number[]) => {
      setStrokeDashArray(value);
      canvas.getActiveObjects().forEach((object) => {
        object.set({ strokeDashArray: value });
      });
      canvas.renderAll();
    },
    addCircle: () => {
      const object = new fabric.Circle({
        ...CIRCLE_OPTIONS,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: strokeDashArray,
      });

      addToCanvas(object);
    },
    addSoftRectangle: () => {
      const object = new fabric.Rect({
        ...RECTANGLE_OPTIONS,
        rx: 50,
        ry: 50,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: strokeDashArray,
      });

      addToCanvas(object);
    },
    addRectangle: () => {
      const object = new fabric.Rect({
        ...RECTANGLE_OPTIONS,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: strokeDashArray,
      });

      addToCanvas(object);
    },
    addTriangle: () => {
      const object = new fabric.Triangle({
        ...TRIANGLE_OPTIONS,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: strokeDashArray,
      });

      addToCanvas(object);
    },
    addInverseTriangle: () => {
      const HEIGHT = TRIANGLE_OPTIONS.height;
      const WIDTH = TRIANGLE_OPTIONS.width;

      const object = new fabric.Polygon(
        [
          { x: 0, y: 0 },
          { x: WIDTH, y: 0 },
          { x: WIDTH / 2, y: HEIGHT },
        ],
        {
          ...TRIANGLE_OPTIONS,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          strokeDashArray: strokeDashArray,
        }
      );

      addToCanvas(object);
    },
    addDiamond: () => {
      const HEIGHT = DIAMOND_OPTIONS.height;
      const WIDTH = DIAMOND_OPTIONS.width;

      const object = new fabric.Polygon(
        [
          { x: WIDTH / 2, y: 0 },
          { x: WIDTH, y: HEIGHT / 2 },
          { x: WIDTH / 2, y: HEIGHT },
          { x: 0, y: HEIGHT / 2 },
        ],
        {
          ...DIAMOND_OPTIONS,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          strokeDashArray: strokeDashArray,
        }
      );
      addToCanvas(object);
    },
    canvas,
    getActiveFontWeight: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return FONT_WEIGHT;
      }

      // @ts-ignore
      // Faulty TS library, fontWeight exists.
      const value = selectedObject.get("fontWeight") || FONT_WEIGHT;

      return value;
    },
    getActiveFontFamily: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return fontFamily;
      }

      // @ts-ignore
      // Faulty TS library, fontFamily exists.
      const value = selectedObject.get("fontFamily") || fontFamily;

      return value;
    },
    getActiveFillColor: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return fillColor;
      }

      const value = selectedObject.get("fill") || fillColor;

      // Currently, gradients & patterns are not supported
      return value as string;
    },
    getActiveStrokeColor: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return strokeColor;
      }

      const value = selectedObject.get("stroke") || strokeColor;

      return value;
    },
    getActiveStrokeWidth: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return strokeWidth;
      }

      const value = selectedObject.get("strokeWidth") || strokeWidth;

      return value;
    },
    getActiveStrokeDashArray: () => {
      const selectedObject = selectedObjects[0];

      if (!selectedObject) {
        return strokeDashArray;
      }

      const value = selectedObject.get("strokeDashArray") || strokeDashArray;

      return value;
    },
    selectedObjects,
    showBleed,
    showSafeZone,
    toggleBleed: () => {
      const workspace = getWorkspace();
      if (!workspace) return;

      const { TRIM_WIDTH, TRIM_HEIGHT, BLEED_WIDTH, BLEED_HEIGHT } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

      const newShowBleed = !showBleed;
      setShowBleed(newShowBleed);

      // Resize workspace based on bleed toggle
      const newWidth = newShowBleed ? BLEED_WIDTH : TRIM_WIDTH;
      const newHeight = newShowBleed ? BLEED_HEIGHT : TRIM_HEIGHT;

      // Get current center to maintain position
      const center = workspace.getCenterPoint();
      if (center) {
        workspace.set({
          width: newWidth,
          height: newHeight,
          left: center.x - newWidth / 2,
          top: center.y - newHeight / 2,
        });
        canvas.clipPath = workspace;
        canvas.renderAll();
        autoZoom();
      }
    },
    toggleSafeZone: () => {
      setShowSafeZone(!showSafeZone);
    },
  };
};

export const useEditor = ({
  defaultState,
  defaultHeight,
  defaultWidth,
  clearSelectionCallback,
  saveCallback,
}: EditorHookProps) => {
  const initialState = useRef(defaultState);
  const initialWidth = useRef(defaultWidth);
  const initialHeight = useRef(defaultHeight);

  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [selectedObjects, setSelectedObjects] = useState<fabric.Object[]>([]);

  const [fontFamily, setFontFamily] = useState(FONT_FAMILY);
  const [fillColor, setFillColor] = useState(FILL_COLOR);
  const [strokeColor, setStrokeColor] = useState(STROKE_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(STROKE_WIDTH);
  const [strokeDashArray, setStrokeDashArray] = useState<number[]>(STROKE_DASH_ARRAY);
  const [showBleed, setShowBleed] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [zoom, setZoom] = useState(1);

  useWindowEvents();

  const { 
    save, 
    canRedo, 
    canUndo, 
    undo, 
    redo,
    canvasHistory,
    setHistoryIndex,
  } = useHistory({ 
    canvas,
    saveCallback
  });

  const { copy, paste } = useClipboard({ canvas });

  const { autoZoom } = useAutoResize({
    canvas,
    container,
  });

  useCanvasEvents({
    save,
    canvas,
    setSelectedObjects,
    clearSelectionCallback,
  });

  useHotkeys({
    undo,
    redo,
    copy,
    paste,
    save,
    canvas,
  });

  useLoadState({
    canvas,
    autoZoom,
    initialState,
    canvasHistory,
    setHistoryIndex,
    defaultWidth: initialWidth,
    defaultHeight: initialHeight,
  });

  // Get workspace for bleed overlay
  // Recalculate when canvas or bleed state changes
  const workspace = useMemo(() => {
    if (!canvas) return undefined;
    return canvas.getObjects().find((object) => object.name === "clip") as fabric.Rect | undefined;
  }, [canvas, showBleed]);

  // Integrate bleed overlay
  useBleedOverlay({
    canvas,
    showBleed,
    showSafeZone,
    workspace,
  });

  // Integrate snap-to-trim functionality
  useSnapToTrim({
    canvas,
    workspace,
    showBleed,
  });

  // Sync zoom state with canvas zoom changes
  useEffect(() => {
    if (!canvas) return;

    const updateZoom = () => {
      const currentZoom = canvas.getZoom();
      setZoom(currentZoom);
    };

    // Update zoom when canvas zoom changes
    canvas.on('mouse:wheel', updateZoom);
    canvas.on('object:modified', updateZoom);

    // Initial zoom sync
    updateZoom();

    return () => {
      canvas.off('mouse:wheel', updateZoom);
      canvas.off('object:modified', updateZoom);
    };
  }, [canvas]);

  const editor = useMemo(() => {
    if (canvas) {
      return buildEditor({
        save,
        undo,
        redo,
        canUndo,
        canRedo,
        autoZoom,
        copy,
        paste,
        canvas,
        fillColor,
        strokeWidth,
        strokeColor,
        setFillColor,
        setStrokeColor,
        setStrokeWidth,
        strokeDashArray,
        selectedObjects,
        setStrokeDashArray,
        fontFamily,
        setFontFamily,
        showBleed,
        showSafeZone,
        setShowBleed,
        setShowSafeZone,
        zoom,
        setZoom,
      });
    }

    return undefined;
  }, 
  [
    canRedo,
    canUndo,
    undo,
    redo,
    save,
    autoZoom,
    copy,
    paste,
    canvas,
    fillColor,
    strokeWidth,
    strokeColor,
    selectedObjects,
    strokeDashArray,
    fontFamily,
    showBleed,
    showSafeZone,
    zoom,
  ]);

  const init = useCallback(
    ({
      initialCanvas,
      initialContainer,
    }: {
      initialCanvas: fabric.Canvas;
      initialContainer: HTMLDivElement;
    }) => {
      fabric.Object.prototype.set({
        cornerColor: "#FFF",
        cornerStyle: "circle",
        borderColor: "#3b82f6",
        borderScaleFactor: 1.5,
        transparentCorners: false,
        borderOpacityWhenMoving: 1,
        cornerStrokeColor: "#3b82f6",
      });

      const initialWorkspace = new fabric.Rect({
        width: initialWidth.current,
        height: initialHeight.current,
        name: "clip",
        fill: "white",
        selectable: false,
        hasControls: false,
        shadow: new fabric.Shadow({
          color: "rgba(0,0,0,0.8)",
          blur: 5,
        }),
      });

      initialCanvas.setWidth(initialContainer.offsetWidth);
      initialCanvas.setHeight(initialContainer.offsetHeight);

      initialCanvas.add(initialWorkspace);
      initialCanvas.centerObject(initialWorkspace);
      initialCanvas.clipPath = initialWorkspace;

      setCanvas(initialCanvas);
      setContainer(initialContainer);

      const currentState = JSON.stringify(
        initialCanvas.toJSON(JSON_KEYS)
      );
      canvasHistory.current = [currentState];
      setHistoryIndex(0);
    },
    [
      canvasHistory, // No need, this is from useRef
      setHistoryIndex, // No need, this is from useState
    ]
  );

  return { init, editor };
};
