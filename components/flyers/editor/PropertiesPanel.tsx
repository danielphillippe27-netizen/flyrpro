'use client';

import { useFlyerEditorStore } from './useFlyerEditorStore';
import type { FlyerElement, FlyerTextElement, FlyerImageElement, FlyerQRElement } from '@/lib/flyers/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function PropertiesPanel() {
  const { selectedElementId, flyerData, updateElement } = useFlyerEditorStore();

  const selectedElement = selectedElementId
    ? flyerData.elements.find((el) => el.id === selectedElementId)
    : null;

  if (!selectedElement) {
    return (
      <div className="w-80 bg-slate-900 border-l border-slate-800 p-4">
        <div className="text-center text-slate-500 mt-8">
          <p className="text-sm">Select an element to edit</p>
        </div>
      </div>
    );
  }

  const handleUpdate = (updates: Partial<FlyerElement>) => {
    if (selectedElementId) {
      updateElement(selectedElementId, updates);
    }
  };

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">
        Properties
      </h2>

      <div className="space-y-4">
        {selectedElement.type === 'text' && (
          <TextElementProperties
            element={selectedElement}
            onUpdate={handleUpdate}
          />
        )}

        {selectedElement.type === 'image' && (
          <ImageElementProperties
            element={selectedElement}
            onUpdate={handleUpdate}
          />
        )}

        {selectedElement.type === 'qr' && (
          <QRElementProperties
            element={selectedElement}
            onUpdate={handleUpdate}
          />
        )}

        {/* Common properties */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase">Position</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-slate-500">X</Label>
              <Input
                type="number"
                value={Math.round(selectedElement.x)}
                onChange={(e) => handleUpdate({ x: parseFloat(e.target.value) || 0 })}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-500">Y</Label>
              <Input
                type="number"
                value={Math.round(selectedElement.y)}
                onChange={(e) => handleUpdate({ y: parseFloat(e.target.value) || 0 })}
                className="h-8 text-sm"
              />
            </div>
          </div>
          {selectedElement.type !== 'qr' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-500">Width</Label>
                <Input
                  type="number"
                  value={Math.round(selectedElement.width)}
                  onChange={(e) => handleUpdate({ width: parseFloat(e.target.value) || 0 })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Height</Label>
                <Input
                  type="number"
                  value={Math.round(selectedElement.height)}
                  onChange={(e) => handleUpdate({ height: parseFloat(e.target.value) || 0 })}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs text-slate-500">Rotation</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.rotation)}
              onChange={(e) => handleUpdate({ rotation: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm"
              step="1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TextElementProperties({
  element,
  onUpdate,
}: {
  element: FlyerTextElement;
  onUpdate: (updates: Partial<FlyerElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-slate-500">Text</Label>
        <Textarea
          value={element.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          className="h-24 text-sm mt-1"
          placeholder="Enter text..."
        />
      </div>

      <div>
        <Label className="text-xs text-slate-500">Font Family</Label>
        <Select
          value={element.fontFamily}
          onValueChange={(value) => onUpdate({ fontFamily: value })}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Arial">Arial</SelectItem>
            <SelectItem value="Helvetica">Helvetica</SelectItem>
            <SelectItem value="Times New Roman">Times New Roman</SelectItem>
            <SelectItem value="Courier New">Courier New</SelectItem>
            <SelectItem value="Georgia">Georgia</SelectItem>
            <SelectItem value="Verdana">Verdana</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs text-slate-500">Font Size</Label>
        <Input
          type="number"
          value={element.fontSize}
          onChange={(e) => onUpdate({ fontSize: parseFloat(e.target.value) || 12 })}
          className="h-8 text-sm mt-1"
          min="8"
          max="200"
        />
      </div>

      <div>
        <Label className="text-xs text-slate-500">Font Weight</Label>
        <Select
          value={element.fontWeight || 'normal'}
          onValueChange={(value: 'normal' | 'bold') => onUpdate({ fontWeight: value })}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="bold">Bold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs text-slate-500">Text Align</Label>
        <Select
          value={element.align || 'left'}
          onValueChange={(value: 'left' | 'center' | 'right') => onUpdate({ align: value })}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs text-slate-500">Color</Label>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={element.fill}
            onChange={(e) => onUpdate({ fill: e.target.value })}
            className="w-12 h-8 rounded cursor-pointer"
          />
          <Input
            type="text"
            value={element.fill}
            onChange={(e) => onUpdate({ fill: e.target.value })}
            className="h-8 text-sm flex-1"
            placeholder="#000000"
          />
        </div>
      </div>
    </div>
  );
}

function ImageElementProperties({
  element,
  onUpdate,
}: {
  element: FlyerImageElement;
  onUpdate: (updates: Partial<FlyerElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-slate-500">Image URL</Label>
        <Input
          type="text"
          value={element.imageUrl}
          onChange={(e) => onUpdate({ imageUrl: e.target.value })}
          className="h-8 text-sm mt-1"
          readOnly
        />
        <p className="text-xs text-slate-500 mt-1">Uploaded image</p>
      </div>

      <div>
        <Label className="text-xs text-slate-500">Object Fit</Label>
        <Select
          value={element.objectFit || 'contain'}
          onValueChange={(value: 'cover' | 'contain') => onUpdate({ objectFit: value })}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contain">Contain</SelectItem>
            <SelectItem value="cover">Cover</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function QRElementProperties({
  element,
  onUpdate,
}: {
  element: FlyerQRElement;
  onUpdate: (updates: Partial<FlyerElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-slate-500">URL</Label>
        <Input
          type="text"
          value={element.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          className="h-8 text-sm mt-1"
          placeholder="https://..."
        />
      </div>

      <div>
        <Label className="text-xs text-slate-500">Size</Label>
        <Input
          type="number"
          value={element.size}
          onChange={(e) => onUpdate({ size: parseFloat(e.target.value) || 100 })}
          className="h-8 text-sm mt-1"
          min="50"
          max="500"
        />
      </div>
    </div>
  );
}


