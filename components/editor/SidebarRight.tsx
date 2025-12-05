'use client';

import { useState } from 'react';
import { useEditorStore } from '@/lib/editor/state';
import { ColorPicker } from './ColorPicker';
import { FontSelector } from './FontSelector';
import { NumericInput } from './NumericInput';
import { Separator } from './Separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayersPanel } from './LayersPanel';
import { BleedWarning } from './BleedWarning';
import { toast } from 'sonner';
import type { TextElement, RectElement, CircleElement, ImageElement, QRElement } from '@/lib/editor/types';

export function SidebarRight() {
  const {
    pages,
    currentPageId,
    elements,
    selectedIds,
    updateElement,
    alignSelected,
    groupSelected,
    ungroup,
  } = useEditorStore();

  const page = pages[currentPageId];
  const selectedCount = selectedIds.length;
  const selectedElement = selectedCount === 1 ? elements[selectedIds[0]] : null;

  // No selection - show page properties
  if (selectedCount === 0) {
    return (
      <div className="sidebar w-80 bg-slate-900 border-l border-slate-800 flex flex-col" style={{ pointerEvents: 'auto' }}>
        <Tabs defaultValue="properties" className="flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="layers">Layers</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="properties" className="flex-1 overflow-y-auto m-0 p-4 space-y-4">
          <div className="text-sm text-slate-400">No element selected</div>
          {page && (
            <>
              <Separator />
              <div>
                <Label className="text-xs text-slate-300 mb-1.5 block">Page Background</Label>
                <ColorPicker
                  value={page.backgroundColor}
                  onChange={(color) => {
                    const newPages = {
                      ...pages,
                      [currentPageId]: {
                        ...page,
                        backgroundColor: color,
                      },
                    };
                    useEditorStore.setState({ pages: newPages });
                    useEditorStore.getState().pushHistory();
                  }}
                />
              </div>
              <NumericInput
                label="Page Width"
                value={page.width}
                onChange={(width) => {
                  const newPages = {
                    ...pages,
                    [currentPageId]: {
                      ...page,
                      width,
                    },
                  };
                  useEditorStore.setState({ pages: newPages });
                  useEditorStore.getState().pushHistory();
                }}
                min={100}
                max={5000}
                unit="px"
              />
              <NumericInput
                label="Page Height"
                value={page.height}
                onChange={(height) => {
                  const newPages = {
                    ...pages,
                    [currentPageId]: {
                      ...page,
                      height,
                    },
                  };
                  useEditorStore.setState({ pages: newPages });
                  useEditorStore.getState().pushHistory();
                }}
                min={100}
                max={5000}
                unit="px"
              />
            </>
          )}
          </TabsContent>
          <TabsContent value="layers" className="flex-1 overflow-y-auto m-0">
            <LayersPanel />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Multiple selection - show group controls
  if (selectedCount > 1) {
    const selectedElements = selectedIds
      .map((id) => elements[id])
      .filter(Boolean);
    const isGroup = selectedElements[0]?.type === 'group';

    return (
      <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col">
        <Tabs defaultValue="properties" className="flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="layers">Layers</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="properties" className="flex-1 overflow-y-auto m-0 p-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-slate-300">Alignment</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('left')}
                className="h-8 text-xs"
              >
                Left
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('center')}
                className="h-8 text-xs"
              >
                Center
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('right')}
                className="h-8 text-xs"
              >
                Right
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('top')}
                className="h-8 text-xs"
              >
                Top
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('middle')}
                className="h-8 text-xs"
              >
                Middle
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelected('bottom')}
                className="h-8 text-xs"
              >
                Bottom
              </Button>
            </div>
          </div>
          <Separator />
          {!isGroup ? (
            <Button
              variant="default"
              size="sm"
              onClick={groupSelected}
              className="w-full"
            >
              Group Elements
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                if (selectedElements[0]?.type === 'group') {
                  ungroup(selectedElements[0].id);
                }
              }}
              className="w-full"
            >
              Ungroup
            </Button>
          )}
          </TabsContent>
          <TabsContent value="layers" className="flex-1 overflow-y-auto m-0">
            <LayersPanel />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Single selection - show full properties
  if (!selectedElement) return null;

  const handleUpdate = (partial: Partial<typeof selectedElement>) => {
    updateElement(selectedElement.id, partial);
  };

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col">
      <Tabs defaultValue="properties" className="flex flex-col flex-1 overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="layers">Layers</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="properties" className="flex-1 overflow-y-auto m-0 p-4 space-y-4">
          {/* Name */}
          <div>
            <Label className="text-xs text-slate-300 mb-1.5 block">Name</Label>
            <Input
              value={selectedElement.name}
              onChange={(e) => handleUpdate({ name: e.target.value })}
              className="h-9"
            />
          </div>

          <Separator />

          {/* Position */}
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="X"
              value={selectedElement.x}
              onChange={(x) => handleUpdate({ x })}
              unit="px"
            />
            <NumericInput
              label="Y"
              value={selectedElement.y}
              onChange={(y) => handleUpdate({ y })}
              unit="px"
            />
          </div>

          {/* Size */}
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Width"
              value={selectedElement.width}
              onChange={(width) => handleUpdate({ width })}
              min={1}
              unit="px"
            />
            <NumericInput
              label="Height"
              value={selectedElement.height}
              onChange={(height) => handleUpdate({ height })}
              min={1}
              unit="px"
            />
          </div>

          {/* Rotation */}
          <NumericInput
            label="Rotation"
            value={selectedElement.rotation}
            onChange={(rotation) => handleUpdate({ rotation })}
            min={-180}
            max={180}
            unit="°"
          />

          {/* Opacity */}
          <div>
            <Label className="text-xs text-slate-300 mb-1.5 block">
              Opacity: {Math.round(selectedElement.opacity * 100)}%
            </Label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selectedElement.opacity}
              onChange={(e) => handleUpdate({ opacity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <Separator />

          {/* Lock & Visibility */}
          <div className="flex gap-2">
            <Button
              variant={selectedElement.locked ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleUpdate({ locked: !selectedElement.locked })}
              className="flex-1"
            >
              {selectedElement.locked ? 'Unlock' : 'Lock'}
            </Button>
            <Button
              variant={selectedElement.visible ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleUpdate({ visible: !selectedElement.visible })}
              className="flex-1"
            >
              {selectedElement.visible ? 'Hide' : 'Show'}
            </Button>
          </div>

          <Separator />

          {/* Bleed Warning */}
          <BleedWarning element={selectedElement} />

          <Separator />

          {/* Type-specific properties */}
          {selectedElement.type === 'text' && (
            <TextProperties element={selectedElement as TextElement} onUpdate={handleUpdate} />
          )}
          {selectedElement.type === 'rect' && (
            <RectProperties element={selectedElement as RectElement} onUpdate={handleUpdate} />
          )}
          {selectedElement.type === 'circle' && (
            <CircleProperties element={selectedElement as CircleElement} onUpdate={handleUpdate} />
          )}
          {selectedElement.type === 'image' && (
            <ImageProperties element={selectedElement as ImageElement} onUpdate={handleUpdate} />
          )}
          {selectedElement.type === 'qrcode' && (
            <QRProperties element={selectedElement as QRElement} onUpdate={handleUpdate} />
          )}
        </TabsContent>
        <TabsContent value="layers" className="flex-1 overflow-y-auto m-0">
          <LayersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Type-specific property components
function TextProperties({
  element,
  onUpdate,
}: {
  element: TextElement;
  onUpdate: (partial: Partial<TextElement>) => void;
}) {
  return (
    <>
      <div>
        <Label className="text-xs text-slate-300 mb-1.5 block">Text</Label>
        <Textarea
          value={element.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          className="min-h-20"
        />
      </div>
      <FontSelector
        label="Font Family"
        value={element.fontFamily}
        onChange={(fontFamily) => onUpdate({ fontFamily })}
      />
      <NumericInput
        label="Font Size"
        value={element.fontSize}
        onChange={(fontSize) => onUpdate({ fontSize })}
        min={8}
        max={200}
        unit="px"
      />
      <div>
        <Label className="text-xs text-slate-300 mb-1.5 block">Font Weight</Label>
        <select
          value={element.fontWeight}
          onChange={(e) => onUpdate({ fontWeight: e.target.value as TextElement['fontWeight'] })}
          className="w-full h-9 rounded-md border border-slate-700 bg-slate-800 text-slate-50 px-3 text-sm"
        >
          <option value="normal">Normal</option>
          <option value="500">500</option>
          <option value="600">600</option>
          <option value="bold">Bold</option>
          <option value="700">700</option>
        </select>
      </div>
      <div>
        <Label className="text-xs text-slate-300 mb-1.5 block">Alignment</Label>
        <select
          value={element.align}
          onChange={(e) => onUpdate({ align: e.target.value as TextElement['align'] })}
          className="w-full h-9 rounded-md border border-slate-700 bg-slate-800 text-slate-50 px-3 text-sm"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      <ColorPicker
        label="Text Color"
        value={element.fill}
        onChange={(fill) => onUpdate({ fill })}
      />
    </>
  );
}

function RectProperties({
  element,
  onUpdate,
}: {
  element: RectElement;
  onUpdate: (partial: Partial<RectElement>) => void;
}) {
  return (
    <>
      <ColorPicker
        label="Fill Color"
        value={element.fill}
        onChange={(fill) => onUpdate({ fill })}
      />
      <ColorPicker
        label="Stroke Color"
        value={element.stroke || '#000000'}
        onChange={(stroke) => onUpdate({ stroke })}
      />
      <NumericInput
        label="Stroke Width"
        value={element.strokeWidth || 0}
        onChange={(strokeWidth) => onUpdate({ strokeWidth })}
        min={0}
        max={20}
        unit="px"
      />
      <NumericInput
        label="Corner Radius"
        value={element.cornerRadius}
        onChange={(cornerRadius) => onUpdate({ cornerRadius })}
        min={0}
        max={100}
        unit="px"
      />
    </>
  );
}

function CircleProperties({
  element,
  onUpdate,
}: {
  element: CircleElement;
  onUpdate: (partial: Partial<CircleElement>) => void;
}) {
  return (
    <>
      <ColorPicker
        label="Fill Color"
        value={element.fill}
        onChange={(fill) => onUpdate({ fill })}
      />
      <ColorPicker
        label="Stroke Color"
        value={element.stroke || '#000000'}
        onChange={(stroke) => onUpdate({ stroke })}
      />
      <NumericInput
        label="Stroke Width"
        value={element.strokeWidth || 0}
        onChange={(strokeWidth) => onUpdate({ strokeWidth })}
        min={0}
        max={20}
        unit="px"
      />
    </>
  );
}

function ImageProperties({
  element,
  onUpdate,
}: {
  element: ImageElement;
  onUpdate: (partial: Partial<ImageElement>) => void;
}) {
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [backgroundRemoverError, setBackgroundRemoverError] = useState<string | null>(null);
  const { pushHistory } = useEditorStore();

  const handleRemoveBackground = async () => {
    if (!element.imageUrl) {
      setBackgroundRemoverError('No image URL to process');
      return;
    }

    setIsRemovingBackground(true);
    setBackgroundRemoverError(null);

    try {
      const response = await fetch('/api/background-remover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageUrl: element.imageUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove background');
      }

      // Update the image URL with the new background-removed image
      onUpdate({ imageUrl: data.url });
      
      // Push to history for undo/redo support
      pushHistory();

      toast.success('Background removed – new image added.');
    } catch (err: any) {
      const errorMessage = err?.message || 'We couldn\'t remove the background. Please try another image.';
      setBackgroundRemoverError(errorMessage);
      console.error('Background removal error:', err);
    } finally {
      setIsRemovingBackground(false);
    }
  };

  return (
    <>
      <div>
        <Label className="text-xs text-slate-300 mb-1.5 block">Image URL</Label>
        <Input
          value={element.imageUrl}
          onChange={(e) => onUpdate({ imageUrl: e.target.value })}
          className="h-9"
          placeholder="https://..."
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="maintain-aspect"
          checked={element.maintainAspectRatio || false}
          onChange={(e) => onUpdate({ maintainAspectRatio: e.target.checked })}
          className="w-4 h-4"
        />
        <Label htmlFor="maintain-aspect" className="text-xs text-slate-300 cursor-pointer">
          Maintain Aspect Ratio
        </Label>
      </div>

      <Separator />

      {/* Background Remover Section */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs font-semibold text-slate-50 mb-1.5 block">
            Background Remover
          </Label>
          <p className="text-xs text-slate-400 mb-3">
            Erase the background from your photo in one click. Works best on clear subjects.
          </p>
          <Button
            onClick={handleRemoveBackground}
            disabled={isRemovingBackground || !element.imageUrl}
            className="w-full"
            size="sm"
          >
            {isRemovingBackground ? 'Removing...' : 'Remove background'}
          </Button>
          {backgroundRemoverError && (
            <p className="text-xs text-red-400 mt-2">{backgroundRemoverError}</p>
          )}
          <p className="text-xs text-slate-500 mt-2">
            We'll create a new image with a transparent background so you can keep the original.
          </p>
        </div>
      </div>
    </>
  );
}

function QRProperties({
  element,
  onUpdate,
}: {
  element: QRElement;
  onUpdate: (partial: Partial<QRElement>) => void;
}) {
  return (
    <>
      <div>
        <Label className="text-xs text-slate-300 mb-1.5 block">Target URL</Label>
        <Input
          value={element.targetUrl}
          onChange={(e) => onUpdate({ targetUrl: e.target.value })}
          className="h-9"
          placeholder="https://..."
        />
      </div>
      <div className="text-xs text-slate-400">
        QR codes are square. Width and height should be equal.
      </div>
    </>
  );
}

