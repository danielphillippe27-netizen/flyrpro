'use client';

import { Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown, MoveUp, MoveDown } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/state';
import { IconButton } from './IconButton';
import { Separator } from './Separator';
import type { EditorElement } from '@/lib/editor/types';

export function LayersPanel() {
  const {
    pages,
    currentPageId,
    elements,
    selectedIds,
    selectSingle,
    updateElement,
    bringToFront,
    sendToBack,
    moveZIndex,
  } = useEditorStore();

  const page = pages[currentPageId];
  if (!page) return null;

  // Get elements in reverse z-order (front to back) for display
  const orderedElements = [...page.elementIds]
    .reverse()
    .map((id) => elements[id])
    .filter((el): el is EditorElement => el !== undefined);

  const getElementIcon = (element: EditorElement) => {
    switch (element.type) {
      case 'text':
        return 'T';
      case 'rect':
        return '□';
      case 'circle':
        return '○';
      case 'image':
        return '🖼';
      case 'qrcode':
        return 'QR';
      case 'group':
        return '📦';
      default:
        return '?';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {orderedElements.length === 0 ? (
          <div className="p-4 text-sm text-slate-400 text-center">No layers</div>
        ) : (
          <div className="p-2">
            {orderedElements.map((element) => {
              const isSelected = selectedIds.includes(element.id);
              return (
                <div
                  key={element.id}
                  className={`
                    flex items-center gap-2 p-2 rounded cursor-pointer mb-1
                    ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-800'}
                  `}
                  onClick={() => selectSingle(element.id)}
                >
                  {/* Visibility Toggle */}
                  <IconButton
                    icon={element.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateElement(element.id, { visible: !element.visible });
                    }}
                    size="sm"
                    variant="ghost"
                    title={element.visible ? 'Hide' : 'Show'}
                  />

                  {/* Lock Toggle */}
                  <IconButton
                    icon={element.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateElement(element.id, { locked: !element.locked });
                    }}
                    size="sm"
                    variant="ghost"
                    title={element.locked ? 'Unlock' : 'Lock'}
                  />

                  {/* Element Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-50 truncate">
                      {element.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {getElementIcon(element)} {element.type}
                    </div>
                  </div>

                  {/* Z-Index Controls */}
                  <div className="flex flex-col gap-0.5">
                    <IconButton
                      icon={<MoveUp className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        bringToFront(element.id);
                      }}
                      size="sm"
                      variant="ghost"
                      title="Bring to Front"
                    />
                    <IconButton
                      icon={<ArrowUp className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveZIndex(element.id, 'up');
                      }}
                      size="sm"
                      variant="ghost"
                      title="Move Up"
                    />
                    <IconButton
                      icon={<ArrowDown className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveZIndex(element.id, 'down');
                      }}
                      size="sm"
                      variant="ghost"
                      title="Move Down"
                    />
                    <IconButton
                      icon={<MoveDown className="w-3 h-3" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        sendToBack(element.id);
                      }}
                      size="sm"
                      variant="ghost"
                      title="Send to Back"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

