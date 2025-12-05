"use client";

import { useState, useMemo, useEffect } from "react";
import { Eye, EyeOff, Lock, Unlock, Trash2, GripVertical, Type, Square, Circle, Image as ImageIcon, Layers as LayersIcon } from "lucide-react";
import { fabric } from "fabric";
import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";
import { cn } from "@/lib/editor-canva/lib/utils";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";
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

interface LayersSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
}

interface LayerItem {
  id: string;
  object: fabric.Object;
  name: string;
  type: string;
  isVisible: boolean;
  isLocked: boolean;
}

function SortableLayerRow({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onRename,
}: {
  layer: LayerItem;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
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
    const type = layer.type.toLowerCase();
    if (type.includes('text') || type === 'itext' || type === 'textbox') {
      return <Type className="w-4 h-4" />;
    } else if (type === 'rect' || type === 'rectangle') {
      return <Square className="w-4 h-4" />;
    } else if (type === 'circle') {
      return <Circle className="w-4 h-4" />;
    } else if (type === 'image' || type.includes('image')) {
      return <ImageIcon className="w-4 h-4" />;
    } else {
      return <LayersIcon className="w-4 h-4" />;
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
      className={cn(
        "flex items-center gap-2 p-2 rounded cursor-pointer mb-1 transition-colors",
        isSelected ? "bg-blue-100 border border-blue-300" : "hover:bg-gray-100",
        !layer.isVisible && "opacity-50",
        layer.isLocked && "opacity-75"
      )}
      onClick={onSelect}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      <div className="text-gray-500 flex-shrink-0">
        {getElementIcon()}
      </div>

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleKeyDown}
            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="text-xs font-medium text-gray-900 truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleDoubleClick();
            }}
            title={layer.name}
          >
            {layer.name}
          </div>
        )}
        <div className="text-xs text-gray-500 capitalize">
          {layer.type}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          className="p-1 hover:bg-gray-200 rounded"
          title={layer.isVisible ? 'Hide' : 'Show'}
        >
          {layer.isVisible ? (
            <Eye className="w-4 h-4 text-gray-600" />
          ) : (
            <EyeOff className="w-4 h-4 text-gray-400" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          className="p-1 hover:bg-gray-200 rounded"
          title={layer.isLocked ? 'Unlock' : 'Lock'}
        >
          {layer.isLocked ? (
            <Lock className="w-4 h-4 text-gray-600" />
          ) : (
            <Unlock className="w-4 h-4 text-gray-400" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${layer.name}"?`)) {
              onDelete();
            }
          }}
          className="p-1 hover:bg-gray-200 rounded text-red-500"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export const LayersSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: LayersSidebarProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [refreshKey, setRefreshKey] = useState(0);

  // Force re-render when canvas changes
  useEffect(() => {
    if (!editor?.canvas) return;
    
    const handleChange = () => {
      setRefreshKey((prev) => prev + 1);
    };

    editor.canvas.on('object:added', handleChange);
    editor.canvas.on('object:removed', handleChange);
    editor.canvas.on('object:modified', handleChange);
    editor.canvas.on('selection:created', handleChange);
    editor.canvas.on('selection:updated', handleChange);
    editor.canvas.on('selection:cleared', handleChange);

    return () => {
      editor.canvas.off('object:added', handleChange);
      editor.canvas.off('object:removed', handleChange);
      editor.canvas.off('object:modified', handleChange);
      editor.canvas.off('selection:created', handleChange);
      editor.canvas.off('selection:updated', handleChange);
      editor.canvas.off('selection:cleared', handleChange);
    };
  }, [editor?.canvas]);

  const layers = useMemo(() => {
    if (!editor?.canvas) return [];

    const objects = editor.canvas.getObjects();
    // Filter out the workspace/clip object
    const visibleObjects = objects.filter((obj) => obj.name !== "clip");

    // Get layers in reverse order (topmost first)
    return visibleObjects
      .slice()
      .reverse()
      .map((obj, index) => {
        const type = obj.type || 'unknown';
        const name = (obj as any).name || `${type} ${index + 1}`;
        const id = obj.name || `layer-${obj.uid || index}`;
        
        return {
          id,
          object: obj,
          name,
          type,
          isVisible: obj.visible !== false,
          isLocked: obj.selectable === false || (obj as any).lockMovementX || (obj as any).lockMovementY,
        };
      });
  }, [editor?.canvas, editor?.selectedObjects, refreshKey]);

  const selectedObjectIds = useMemo(() => {
    if (!editor?.selectedObjects) return [];
    return editor.selectedObjects.map((obj) => obj.name || `layer-${obj.uid || ''}`).filter(Boolean);
  }, [editor?.selectedObjects, refreshKey]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!editor?.canvas) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = layers.findIndex((layer) => layer.id === active.id);
    const newIndex = layers.findIndex((layer) => layer.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Convert display indices (top→bottom) to canvas indices (back→front)
    const canvasObjects = editor.canvas.getObjects().filter((obj) => obj.name !== "clip");
    const reversedObjects = [...canvasObjects].reverse();
    
    const sourceObject = reversedObjects[oldIndex];
    const destObject = reversedObjects[newIndex];

    if (!sourceObject || !destObject) return;

    // Find indices in original array
    const sourceIndex = canvasObjects.indexOf(sourceObject);
    const destIndex = canvasObjects.indexOf(destObject);

    if (sourceIndex === -1 || destIndex === -1) return;

    // Reorder in canvas
    const newObjects = [...canvasObjects];
    const [removed] = newObjects.splice(sourceIndex, 1);
    newObjects.splice(destIndex, 0, removed);

    // Clear and re-add in new order
    const workspace = editor.canvas.getObjects().find((obj) => obj.name === "clip");
    editor.canvas.clear();
    if (workspace) {
      editor.canvas.add(workspace);
      editor.canvas.centerObject(workspace);
      editor.canvas.clipPath = workspace;
    }
    newObjects.forEach((obj) => editor.canvas.add(obj));
    editor.canvas.renderAll();
    editor.save();
  };

  const selectLayer = (layer: LayerItem) => {
    if (!editor?.canvas) return;
    editor.canvas.setActiveObject(layer.object);
    editor.canvas.renderAll();
  };

  const toggleVisibility = (layer: LayerItem) => {
    if (!editor?.canvas) return;
    layer.object.set({ visible: !layer.isVisible });
    editor.canvas.renderAll();
    editor.save();
  };

  const toggleLock = (layer: LayerItem) => {
    if (!editor?.canvas) return;
    const newSelectable = layer.isLocked;
    layer.object.set({ 
      selectable: newSelectable,
      lockMovementX: !newSelectable,
      lockMovementY: !newSelectable,
    });
    editor.canvas.renderAll();
    editor.save();
  };

  const deleteLayer = (layer: LayerItem) => {
    if (!editor?.canvas) return;
    editor.canvas.remove(layer.object);
    editor.canvas.renderAll();
    editor.save();
  };

  const renameLayer = (layer: LayerItem, name: string) => {
    if (!editor?.canvas) return;
    (layer.object as any).name = name;
    editor.save();
  };

  const onClose = () => {
    onChangeActiveTool("select");
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "layers" ? "visible" : "hidden"
      )}
    >
      <ToolSidebarHeader title="Layers" description="Elements on your canvas" />
      <ScrollArea className="flex-1">
        <div className="p-4">
          {layers.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">
              No elements yet. Add text, images, or shapes to see them here.
            </div>
          ) : (
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
                    isSelected={selectedObjectIds.includes(layer.id)}
                    onSelect={() => selectLayer(layer)}
                    onToggleVisibility={() => toggleVisibility(layer)}
                    onToggleLock={() => toggleLock(layer)}
                    onDelete={() => deleteLayer(layer)}
                    onRename={(name) => renameLayer(layer, name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};

