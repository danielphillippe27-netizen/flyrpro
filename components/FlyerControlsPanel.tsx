'use client';

import { useState, useEffect } from 'react';
import type {
  FlyerTemplate,
  FlyerElement,
  FlyerTextElement,
  FlyerImageElement,
  FlyerQRCodeElement,
  FlyerRectElement,
} from '@/lib/types/flyers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FlyerControlsPanelProps {
  template: FlyerTemplate;
  elements: FlyerElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onChangeElement: (updated: FlyerElement) => void;
  onExportPng: () => void;
}

/**
 * Flyer Controls Panel Component
 * 
 * Sidebar panel for editing flyer element properties.
 * Shows template info when no element is selected, and element-specific
 * controls when an element is selected.
 */
export function FlyerControlsPanel({
  template,
  elements,
  selectedElementId,
  onSelectElement,
  onChangeElement,
  onExportPng,
}: FlyerControlsPanelProps) {
  const selectedElement = selectedElementId
    ? elements.find((el) => el.id === selectedElementId)
    : null;

  if (!selectedElement) {
    return (
      <div className="h-full flex flex-col bg-slate-900 border-l border-slate-800 p-4">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {template.name}
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            {template.description || 'No description'}
          </p>
          <div className="text-sm text-slate-500 space-y-1">
            <p>Size: {template.width} × {template.height}px</p>
            <p>Elements: {elements.length}</p>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400 text-center">
            Click an element on the flyer to edit it
          </p>
        </div>

        <div className="mt-auto pt-4 border-t border-slate-800">
          <Button
            onClick={onExportPng}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-medium"
          >
            Export PNG
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-100 mb-1">
          Edit Element
        </h3>
        <p className="text-sm text-slate-400 capitalize">
          {selectedElement.type}
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {selectedElement.type === 'text' && (
          <TextElementControls
            element={selectedElement as FlyerTextElement}
            onChange={onChangeElement}
          />
        )}

        {selectedElement.type === 'image' && (
          <ImageElementControls
            element={selectedElement as FlyerImageElement}
            onChange={onChangeElement}
          />
        )}

        {selectedElement.type === 'qrcode' && (
          <QRCodeElementControls
            element={selectedElement as FlyerQRCodeElement}
            onChange={onChangeElement}
          />
        )}

        {selectedElement.type === 'rect' && (
          <RectElementControls
            element={selectedElement as FlyerRectElement}
            onChange={onChangeElement}
          />
        )}

        {/* Common properties */}
        <div className="pt-4 border-t border-slate-800 space-y-4">
          <h4 className="text-sm font-semibold text-slate-300">
            Position & Appearance
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="x" className="text-slate-400">
                X Position
              </Label>
              <Input
                id="x"
                type="number"
                value={selectedElement.x}
                onChange={(e) =>
                  onChangeElement({
                    ...selectedElement,
                    x: parseFloat(e.target.value) || 0,
                  })
                }
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>

            <div>
              <Label htmlFor="y" className="text-slate-400">
                Y Position
              </Label>
              <Input
                id="y"
                type="number"
                value={selectedElement.y}
                onChange={(e) =>
                  onChangeElement({
                    ...selectedElement,
                    y: parseFloat(e.target.value) || 0,
                  })
                }
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="opacity" className="text-slate-400">
              Opacity: {((selectedElement.opacity ?? 1) * 100).toFixed(0)}%
            </Label>
            <Input
              id="opacity"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selectedElement.opacity ?? 1}
              onChange={(e) =>
                onChangeElement({
                  ...selectedElement,
                  opacity: parseFloat(e.target.value),
                })
              }
              className="bg-slate-800 border-slate-700 text-slate-100"
            />
          </div>

          <div>
            <Label htmlFor="rotation" className="text-slate-400">
              Rotation: {selectedElement.rotation || 0}°
            </Label>
            <Input
              id="rotation"
              type="range"
              min="0"
              max="360"
              step="1"
              value={selectedElement.rotation || 0}
              onChange={(e) =>
                onChangeElement({
                  ...selectedElement,
                  rotation: parseFloat(e.target.value),
                })
              }
              className="bg-slate-800 border-slate-700 text-slate-100"
            />
          </div>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-800">
        <Button
          onClick={onExportPng}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-medium"
        >
          Export PNG
        </Button>
      </div>
    </div>
  );
}

/**
 * Text Element Controls
 */
function TextElementControls({
  element,
  onChange,
}: {
  element: FlyerTextElement;
  onChange: (updated: FlyerElement) => void;
}) {
  const [text, setText] = useState(element.text);
  const [fontSize, setFontSize] = useState(element.fontSize);
  const [fill, setFill] = useState(element.fill);

  useEffect(() => {
    setText(element.text);
    setFontSize(element.fontSize);
    setFill(element.fill);
  }, [element.id]);

  const updateElement = (updates: Partial<FlyerTextElement>) => {
    onChange({
      ...element,
      ...updates,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="text-content" className="text-slate-400">
          Text Content
        </Label>
        <Input
          id="text-content"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            updateElement({ text: e.target.value });
          }}
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
      </div>

      <div>
        <Label htmlFor="font-size" className="text-slate-400">
          Font Size: {fontSize}px
        </Label>
        <Input
          id="font-size"
          type="range"
          min="12"
          max="120"
          step="1"
          value={fontSize}
          onChange={(e) => {
            const newSize = parseInt(e.target.value);
            setFontSize(newSize);
            updateElement({ fontSize: newSize });
          }}
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
      </div>

      <div>
        <Label htmlFor="text-color" className="text-slate-400">
          Text Color
        </Label>
        <div className="flex gap-2">
          <Input
            id="text-color"
            type="color"
            value={fill}
            onChange={(e) => {
              setFill(e.target.value);
              updateElement({ fill: e.target.value });
            }}
            className="h-10 w-20 bg-slate-800 border-slate-700"
          />
          <Input
            type="text"
            value={fill}
            onChange={(e) => {
              setFill(e.target.value);
              updateElement({ fill: e.target.value });
            }}
            className="flex-1 bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="text-align" className="text-slate-400">
          Alignment
        </Label>
        <select
          id="text-align"
          value={element.align || 'left'}
          onChange={(e) =>
            updateElement({
              align: e.target.value as 'left' | 'center' | 'right',
            })
          }
          className="w-full h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100 text-sm"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <div>
        <Label htmlFor="font-weight" className="text-slate-400">
          Font Weight
        </Label>
        <select
          id="font-weight"
          value={element.fontWeight || 'normal'}
          onChange={(e) =>
            updateElement({
              fontWeight: e.target.value as 'normal' | 'bold' | '600' | '700',
            })
          }
          className="w-full h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-slate-100 text-sm"
        >
          <option value="normal">Normal</option>
          <option value="600">Semi-bold</option>
          <option value="bold">Bold</option>
          <option value="700">Extra Bold</option>
        </select>
      </div>
    </div>
  );
}

/**
 * Image Element Controls
 */
function ImageElementControls({
  element,
  onChange,
}: {
  element: FlyerImageElement;
  onChange: (updated: FlyerElement) => void;
}) {
  const [url, setUrl] = useState(element.url);

  useEffect(() => {
    setUrl(element.url);
  }, [element.id]);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="image-url" className="text-slate-400">
          Image URL
        </Label>
        <Input
          id="image-url"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            onChange({
              ...element,
              url: e.target.value,
            });
          }}
          placeholder="https://example.com/image.jpg"
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
        <p className="text-xs text-slate-500 mt-1">
          TODO: File upload coming soon
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="image-width" className="text-slate-400">
            Width
          </Label>
          <Input
            id="image-width"
            type="number"
            value={element.width}
            onChange={(e) =>
              onChange({
                ...element,
                width: parseFloat(e.target.value) || 0,
              })
            }
            className="bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>

        <div>
          <Label htmlFor="image-height" className="text-slate-400">
            Height
          </Label>
          <Input
            id="image-height"
            type="number"
            value={element.height}
            onChange={(e) =>
              onChange({
                ...element,
                height: parseFloat(e.target.value) || 0,
              })
            }
            className="bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * QR Code Element Controls
 */
function QRCodeElementControls({
  element,
  onChange,
}: {
  element: FlyerQRCodeElement;
  onChange: (updated: FlyerElement) => void;
}) {
  const [url, setUrl] = useState(element.url);
  const [size, setSize] = useState(element.size);

  useEffect(() => {
    setUrl(element.url);
    setSize(element.size);
  }, [element.id]);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="qr-url" className="text-slate-400">
          QR Code URL
        </Label>
        <Input
          id="qr-url"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            onChange({
              ...element,
              url: e.target.value,
            });
          }}
          placeholder="https://example.com"
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
      </div>

      <div>
        <Label htmlFor="qr-size" className="text-slate-400">
          Size: {size}px
        </Label>
        <Input
          id="qr-size"
          type="range"
          min="50"
          max="300"
          step="10"
          value={size}
          onChange={(e) => {
            const newSize = parseInt(e.target.value);
            setSize(newSize);
            onChange({
              ...element,
              size: newSize,
            });
          }}
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
      </div>
    </div>
  );
}

/**
 * Rect Element Controls
 */
function RectElementControls({
  element,
  onChange,
}: {
  element: FlyerRectElement;
  onChange: (updated: FlyerElement) => void;
}) {
  const [fill, setFill] = useState(element.fill);

  useEffect(() => {
    setFill(element.fill);
  }, [element.id]);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="rect-fill" className="text-slate-400">
          Fill Color
        </Label>
        <div className="flex gap-2">
          <Input
            id="rect-fill"
            type="color"
            value={fill}
            onChange={(e) => {
              setFill(e.target.value);
              onChange({
                ...element,
                fill: e.target.value,
              });
            }}
            className="h-10 w-20 bg-slate-800 border-slate-700"
          />
          <Input
            type="text"
            value={fill}
            onChange={(e) => {
              setFill(e.target.value);
              onChange({
                ...element,
                fill: e.target.value,
              });
            }}
            className="flex-1 bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rect-width" className="text-slate-400">
            Width
          </Label>
          <Input
            id="rect-width"
            type="number"
            value={element.width}
            onChange={(e) =>
              onChange({
                ...element,
                width: parseFloat(e.target.value) || 0,
              })
            }
            className="bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>

        <div>
          <Label htmlFor="rect-height" className="text-slate-400">
            Height
          </Label>
          <Input
            id="rect-height"
            type="number"
            value={element.height}
            onChange={(e) =>
              onChange({
                ...element,
                height: parseFloat(e.target.value) || 0,
              })
            }
            className="bg-slate-800 border-slate-700 text-slate-100"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="rect-radius" className="text-slate-400">
          Corner Radius: {element.cornerRadius || 0}px
        </Label>
        <Input
          id="rect-radius"
          type="range"
          min="0"
          max="50"
          step="1"
          value={element.cornerRadius || 0}
          onChange={(e) =>
            onChange({
              ...element,
              cornerRadius: parseFloat(e.target.value),
            })
          }
          className="bg-slate-800 border-slate-700 text-slate-100"
        />
      </div>
    </div>
  );
}

