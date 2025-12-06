import { fabric } from "fabric";
import { useEffect, useRef } from "react";

import { JSON_KEYS } from "@/lib/editor-canva/features/editor/types";

interface UseLoadStateProps {
  autoZoom: () => void;
  canvas: fabric.Canvas | null;
  initialState: React.MutableRefObject<string | undefined>;
  canvasHistory: React.MutableRefObject<string[]>;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
  defaultWidth: React.MutableRefObject<number | undefined>;
  defaultHeight: React.MutableRefObject<number | undefined>;
};

export const useLoadState = ({
  canvas,
  autoZoom,
  initialState,
  canvasHistory,
  setHistoryIndex,
  defaultWidth,
  defaultHeight,
}: UseLoadStateProps) => {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && initialState?.current && canvas) {
      const data = JSON.parse(initialState.current);

      canvas.loadFromJSON(data, () => {
        // Ensure workspace exists after loading
        let workspace = canvas.getObjects().find((object) => object.name === "clip");
        
        if (!workspace) {
          // Create workspace if it doesn't exist
          const width = defaultWidth.current || data.width || 2550;
          const height = defaultHeight.current || data.height || 1650;
          
          workspace = new fabric.Rect({
            width,
            height,
            name: "clip",
            fill: "white",
            selectable: false,
            hasControls: false,
            shadow: new fabric.Shadow({
              color: "rgba(0,0,0,0.8)",
              blur: 5,
            }),
          });
          
          canvas.add(workspace);
          canvas.centerObject(workspace);
          canvas.sendToBack(workspace);
          canvas.clipPath = workspace;
        }

        const currentState = JSON.stringify(
          canvas.toJSON(JSON_KEYS),
        );

        canvasHistory.current = [currentState];
        setHistoryIndex(0);
        autoZoom();
      });
      initialized.current = true;
    }
  }, 
  [
    canvas,
    autoZoom,
    initialState, // no need, this is a ref
    canvasHistory, // no need, this is a ref
    setHistoryIndex, // no need, this is a dispatch
    defaultWidth, // no need, this is a ref
    defaultHeight, // no need, this is a ref
  ]);
};
