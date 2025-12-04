'use client';

import { Type, Square, Circle, Image as ImageIcon, QrCode } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/state';
import { Button } from '@/components/ui/button';
import { Separator } from './Separator';
import { getAllTemplates } from '@/lib/editor/templates';
import { generateId } from '@/lib/editor/utils';
import type { TextElement, RectElement, CircleElement, ImageElement, QRElement } from '@/lib/editor/types';

export function SidebarLeft() {
  const { addElement, applyTemplate, pages, currentPageId, zoom, panX, panY } = useEditorStore();
  const templates = getAllTemplates();
  const page = pages[currentPageId];

  // Get center of current view for placing new elements
  const getViewCenter = () => {
    if (!page) return { x: page.width / 2, y: page.height / 2 };
    
    // This is approximate - in a real implementation, you'd get the actual viewport center
    // For now, just use page center
    return { x: page.width / 2, y: page.height / 2 };
  };

  const handleAddText = (variant: 'heading' | 'subheading' | 'body') => {
    const center = getViewCenter();
    const element: TextElement = {
      id: generateId(),
      type: 'text',
      name: variant === 'heading' ? 'Heading' : variant === 'subheading' ? 'Subheading' : 'Body Text',
      x: center.x - 200,
      y: center.y - 30,
      width: 400,
      height: variant === 'heading' ? 60 : variant === 'subheading' ? 40 : 30,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      text: variant === 'heading' ? 'Heading' : variant === 'subheading' ? 'Subheading' : 'Body text',
      fontSize: variant === 'heading' ? 48 : variant === 'subheading' ? 32 : 18,
      fontFamily: 'Arial, sans-serif',
      fontWeight: variant === 'heading' ? 'bold' : variant === 'subheading' ? '600' : 'normal',
      fill: '#000000',
      align: 'left',
    };
    addElement(element);
  };

  const handleAddRect = () => {
    const center = getViewCenter();
    const element: RectElement = {
      id: generateId(),
      type: 'rect',
      name: 'Rectangle',
      x: center.x - 100,
      y: center.y - 75,
      width: 200,
      height: 150,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      fill: '#3b82f6',
      cornerRadius: 0,
    };
    addElement(element);
  };

  const handleAddCircle = () => {
    const center = getViewCenter();
    const element: CircleElement = {
      id: generateId(),
      type: 'circle',
      name: 'Circle',
      x: center.x - 75,
      y: center.y - 75,
      width: 150,
      height: 150,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      fill: '#3b82f6',
    };
    addElement(element);
  };

  const handleAddImage = () => {
    const center = getViewCenter();
    const element: ImageElement = {
      id: generateId(),
      type: 'image',
      name: 'Image',
      x: center.x - 150,
      y: center.y - 100,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      imageUrl: 'https://via.placeholder.com/300x200/cccccc/666666?text=Image',
      maintainAspectRatio: true,
    };
    addElement(element);
  };

  const handleAddQR = () => {
    const center = getViewCenter();
    const element: QRElement = {
      id: generateId(),
      type: 'qrcode',
      name: 'QR Code',
      x: center.x - 100,
      y: center.y - 100,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      targetUrl: 'https://example.com',
    };
    addElement(element);
  };

  const handleApplyTemplate = (templateId: string) => {
    if (confirm('This will replace your current design. Continue?')) {
      applyTemplate(templateId);
    }
  };

  return (
    <div className="sidebar w-64 bg-slate-900 border-r border-slate-800 flex flex-col" style={{ pointerEvents: 'auto' }}>
      {/* Templates Section */}
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-slate-50 mb-3">Templates</h3>
        <div className="space-y-2">
          {templates.map((template) => (
            <Button
              key={template.id}
              variant="outline"
              size="sm"
              className="w-full justify-start text-left h-auto py-2 px-3"
              onClick={() => handleApplyTemplate(template.id)}
            >
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-50">{template.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">{template.description}</div>
              </div>
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Elements Section */}
      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-sm font-semibold text-slate-50 mb-3">Elements</h3>
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => handleAddText('heading')}
          >
            <Type className="w-4 h-4 mr-2" />
            Add Heading
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => handleAddText('subheading')}
          >
            <Type className="w-4 h-4 mr-2" />
            Add Subheading
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => handleAddText('body')}
          >
            <Type className="w-4 h-4 mr-2" />
            Add Body Text
          </Button>
          <Separator className="my-2" />
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleAddRect}
          >
            <Square className="w-4 h-4 mr-2" />
            Add Rectangle
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleAddCircle}
          >
            <Circle className="w-4 h-4 mr-2" />
            Add Circle
          </Button>
          <Separator className="my-2" />
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleAddImage}
          >
            <ImageIcon className="w-4 h-4 mr-2" />
            Add Image
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleAddQR}
          >
            <QrCode className="w-4 h-4 mr-2" />
            Add QR Code
          </Button>
        </div>
      </div>
    </div>
  );
}



