'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Trash2, GripVertical, Type, Square, Circle, Image as ImageIcon, QrCode, Layers as LayersIcon } from 'lucide-react';
import { useLayers } from '@/lib/hooks/useLayers';
import { useEditorStore } from '@/lib/editor/state';
import { IconButton } from './IconButton';
import { Separator } from './Separator';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableLayerRowProps {
  layer: ReturnType<typeof useLayers>['layers'][0];
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function SortableLayerRow({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onRename,
}: SortableLayerRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(layer.name);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getElementIcon = () => {
    switch (layer.type) {
      case 'text':
        return <Type className="w-4 h-4" />;
      case 'rect':
        return <Square className="w-4 h-4" />;
      case 'circle':
        return <Circle className="w-4 h-4" />;
      case 'image':
        return <ImageIcon className="w-4 h-4" />;
      case 'qrcode':
        return <QrCode className="w-4 h-4" />;
      case 'group':
        return <LayersIcon className="w-4 h-4" />;
      default:
        return <Square className="w-4 h-4" />;
    }
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditName(layer.name);
  };

  const handleNameSubmit = () => {
    if (editName.trim() && editName !== layer.name) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(layer.name);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 p-2 rounded cursor-pointer mb-1
        ${isSelected ? 'bg-slate-700 border border-slate-600' : 'hover:bg-slate-800'}
        ${!layer.isVisible ? 'opacity-50' : ''}
        ${layer.isLocked ? 'opacity-75' : ''}
      `}
      onClick={onSelect}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-300"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Type Icon */}
      <div className="text-slate-400 flex-shrink-0">
        {getElementIcon()}
      </div>

      {/* Element Name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-500"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="text-xs font-medium text-slate-50 truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleDoubleClick();
            }}
            title={layer.name}
          >
            {layer.name}
          </div>
        )}
        <div className="text-xs text-slate-400 capitalize">
          {layer.type}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <IconButton
          icon={layer.isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          size="sm"
          variant="ghost"
          title={layer.isVisible ? 'Hide' : 'Show'}
        />
        <IconButton
          icon={layer.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          size="sm"
          variant="ghost"
          title={layer.isLocked ? 'Unlock' : 'Lock'}
        />
        <IconButton
          icon={<Trash2 className="w-4 h-4" />}
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${layer.name}"?`)) {
              onDelete();
            }
          }}
          size="sm"
          variant="ghost"
          title="Delete"
        />
      </div>
    </div>
  );
}

export function LayersSidebar() {
  const {
    layers,
    selectLayer,
    toggleVisibility,
    toggleLock,
    deleteLayer,
    renameLayer,
    reorderLayers,
  } = useLayers();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = layers.findIndex((layer) => layer.id === active.id);
    const newIndex = layers.findIndex((layer) => layer.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      reorderLayers(oldIndex, newIndex);
    }
  };

  const { selectedIds } = useEditorStore();

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-slate-50 mb-1">Layers</h3>
        <p className="text-xs text-slate-400">Elements on your active page</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="p-4 text-sm text-slate-400 text-center">
            No elements yet. Add text, images, or shapes to see them here.
          </div>
        ) : (
          <div className="p-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={layers.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                {layers.map((layer) => (
                  <SortableLayerRow
                    key={layer.id}
                    layer={layer}
                    isSelected={selectedIds.includes(layer.id)}
                    onSelect={() => selectLayer(layer.id)}
                    onToggleVisibility={() => toggleVisibility(layer.id)}
                    onToggleLock={() => toggleLock(layer.id)}
                    onDelete={() => deleteLayer(layer.id)}
                    onRename={(name) => renameLayer(layer.id, name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>
    </div>
  );
}

