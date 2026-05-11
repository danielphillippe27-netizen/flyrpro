import { fabric } from "fabric";
import { useCallback, useRef } from "react";

interface UseClipboardProps {
  canvas: fabric.Canvas | null;
};

export const useClipboard = ({
  canvas
}: UseClipboardProps) => {
  const clipboard = useRef<fabric.Object | null>(null);

  const copy = useCallback(() => {
    canvas?.getActiveObject()?.clone((cloned: fabric.Object) => {
      clipboard.current = cloned;
    });
  }, [canvas]);
  
  const paste = useCallback(() => {
    if (!clipboard.current) return;

    clipboard.current.clone((clonedObj: fabric.Object) => {
      canvas?.discardActiveObject();
      const left = clonedObj.left ?? 0;
      const top = clonedObj.top ?? 0;
      clonedObj.set({
        left: left + 10,
        top: top + 10,
        evented: true,
      });

      if (clonedObj.type === "activeSelection" && canvas) {
        clonedObj.canvas = canvas;
        (clonedObj as fabric.ActiveSelection).forEachObject((obj: fabric.Object) => {
          canvas?.add(obj);
        });
        clonedObj.setCoords();
      } else {
        canvas?.add(clonedObj);
      }

      const current = clipboard.current;
      if (!current) return;
      current.top = (current.top ?? 0) + 10;
      current.left = (current.left ?? 0) + 10;
      canvas?.setActiveObject(clonedObj);
      canvas?.requestRenderAll();
    });
  }, [canvas]);

  return { copy, paste };
};
