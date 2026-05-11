import { uuid } from "uuidv4";
import { fabric } from "fabric";
import type { RGBColor } from "react-color";

type SerializedFabricObject = {
  type?: string;
  objects?: SerializedFabricObject[];
};

type FabricFilterConstructor<TOptions = undefined> = TOptions extends undefined
  ? new () => fabric.IBaseFilter
  : new (options: TOptions) => fabric.IBaseFilter;

type ExtendedFabricFilters = typeof fabric.Image.filters & {
  Polaroid: FabricFilterConstructor;
  Kodachrome: FabricFilterConstructor;
  Brownie: FabricFilterConstructor;
  Vintage: FabricFilterConstructor;
  Technicolor: FabricFilterConstructor;
  RemoveColor: FabricFilterConstructor<{ threshold: number; distance: number }>;
  BlackWhite: FabricFilterConstructor;
  Vibrance: FabricFilterConstructor<{ vibrance: number }>;
  Gamma: FabricFilterConstructor<{ gamma: number[] }>;
};

const filters = fabric.Image.filters as ExtendedFabricFilters;

export function transformText(objects: SerializedFabricObject[] | undefined) {
  if (!objects) return;

  objects.forEach((item) => {
    if (item.objects) {
      transformText(item.objects);
    } else {
      if (item.type === "text") item.type = "textbox";
    }
  });
};

export function downloadFile(file: string, type: string) {
  const anchorElement = document.createElement("a");

  anchorElement.href = file;
  anchorElement.download = `${uuid()}.${type}`;
  document.body.appendChild(anchorElement);
  anchorElement.click();
  anchorElement.remove();
};

export function isTextType(type: string | undefined) {
  return type === "text" || type === "i-text" || type === "textbox";
};

export function rgbaObjectToString(rgba: RGBColor | "transparent") {
  if (rgba === "transparent") {
    return `rgba(0,0,0,0)`;
  }

  const alpha = rgba.a === undefined ? 1 : rgba.a;

  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`;
};

export const createFilter = (value: string): fabric.IBaseFilter | null | undefined => {
  let effect: fabric.IBaseFilter | null;

  switch (value) {
    case "greyscale":
      effect = new fabric.Image.filters.Grayscale();
      break;
    case "polaroid":
      effect = new filters.Polaroid();
      break;
    case "sepia":
      effect = new fabric.Image.filters.Sepia();
      break;
    case "kodachrome":
      effect = new filters.Kodachrome();
      break;
    case "contrast":
      effect = new fabric.Image.filters.Contrast({ contrast: 0.3 });
      break;
    case "brightness":
      effect = new fabric.Image.filters.Brightness({ brightness: 0.8 });
      break;
    case "brownie":
      effect = new filters.Brownie();
      break;
    case "vintage":
      effect = new filters.Vintage();
      break;
    case "technicolor":
      effect = new filters.Technicolor();
      break;
    case "pixelate":
      effect = new fabric.Image.filters.Pixelate();
      break;
    case "invert":
      effect = new fabric.Image.filters.Invert();
      break;
    case "blur":
      effect = new fabric.Image.filters.Blur();
      break;
    case "sharpen":
      effect = new fabric.Image.filters.Convolute({
        matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0],
      });
      break;
    case "emboss":
      effect = new fabric.Image.filters.Convolute({
        matrix: [1, 1, 1, 1, 0.7, -1, -1, -1, -1],
      });
      break;
    case "removecolor":
      effect = new filters.RemoveColor({
        threshold: 0.2,
        distance: 0.5
      });
      break;
    case "blacknwhite":
      effect = new filters.BlackWhite();
      break;
    case "vibrance":
      effect = new filters.Vibrance({
        vibrance: 1,
      });
      break;
    case "blendcolor":
      effect = new fabric.Image.filters.BlendColor({ 
        color: "#00ff00",
        mode: "multiply",
      });
      break;
    case "huerotate":
      effect = new fabric.Image.filters.HueRotation({ 
        rotation: 0.5,
      });
      break;
    case "resize":
      effect = new fabric.Image.filters.Resize();
      break;
    case "gamma":
      effect = new filters.Gamma({
        gamma: [1, 0.5, 2.1]
      });
      break;
    case "saturation":
      effect = new fabric.Image.filters.Saturation({
        saturation: 0.7,
      });
      break;
    default:
      effect = null;
      return;
  };

  return effect;
};
