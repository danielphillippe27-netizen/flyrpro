'use client';

import { Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyCenter, AlignHorizontalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd, Group, Ungroup, Download } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/state';
import { IconButton } from './IconButton';
import { Separator } from './Separator';
import { Button } from '@/components/ui/button';

interface TopToolbarProps {
  onExportPng: () => void;
}

export function TopToolbar({ onExportPng }: TopToolbarProps) {
  const {
    selectedIds,
    zoom,
    canUndo,
    canRedo,
    undo,
    redo,
    zoomIn,
    zoomOut,
    zoomToFit,
    setZoom,
    alignSelected,
    groupSelected,
    ungroup,
  } = useEditorStore();

  const hasSelection = selectedIds.length > 0;
  const hasMultipleSelection = selectedIds.length >= 2;
  const selectedElement = hasSelection ? useEditorStore.getState().elements[selectedIds[0]] : null;
  const isGroup = selectedElement?.type === 'group';

  return (
    <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 gap-2">
      {/* Logo */}
      <div className="font-bold text-lg text-slate-50 mr-4">FLYR Editor</div>

      <Separator orientation="vertical" className="h-8" />

      {/* Undo/Redo */}
      <IconButton
        icon={<Undo2 className="w-4 h-4" />}
        onClick={undo}
        disabled={!canUndo()}
        title="Undo (Cmd/Ctrl+Z)"
      />
      <IconButton
        icon={<Redo2 className="w-4 h-4" />}
        onClick={redo}
        disabled={!canRedo()}
        title="Redo (Cmd/Ctrl+Shift+Z)"
      />

      <Separator orientation="vertical" className="h-8" />

      {/* Zoom Controls */}
      <IconButton
        icon={<ZoomOut className="w-4 h-4" />}
        onClick={zoomOut}
        title="Zoom Out"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const container = document.querySelector('[data-canvas-container]') as HTMLElement;
          if (container) {
            zoomToFit(container.clientWidth, container.clientHeight);
          }
        }}
        className="h-9 px-3 text-xs text-slate-300"
        title="Fit to Screen"
      >
        {Math.round(zoom * 100)}%
      </Button>
      <IconButton
        icon={<ZoomIn className="w-4 h-4" />}
        onClick={zoomIn}
        title="Zoom In"
      />
      <IconButton
        icon={<Maximize2 className="w-4 h-4" />}
        onClick={() => {
          const container = document.querySelector('[data-canvas-container]') as HTMLElement;
          if (container) {
            zoomToFit(container.clientWidth, container.clientHeight);
          }
        }}
        title="Fit to Screen"
      />

      <Separator orientation="vertical" className="h-8" />

      {/* Alignment (only show if multiple selected) */}
      {hasMultipleSelection && (
        <>
          <IconButton
            icon={<AlignLeft className="w-4 h-4" />}
            onClick={() => alignSelected('left')}
            title="Align Left"
          />
          <IconButton
            icon={<AlignCenter className="w-4 h-4" />}
            onClick={() => alignSelected('center')}
            title="Align Center"
          />
          <IconButton
            icon={<AlignRight className="w-4 h-4" />}
            onClick={() => alignSelected('right')}
            title="Align Right"
          />
          <IconButton
            icon={<AlignVerticalJustifyStart className="w-4 h-4" />}
            onClick={() => alignSelected('top')}
            title="Align Top"
          />
          <IconButton
            icon={<AlignVerticalJustifyCenter className="w-4 h-4" />}
            onClick={() => alignSelected('middle')}
            title="Align Middle"
          />
          <IconButton
            icon={<AlignVerticalJustifyEnd className="w-4 h-4" />}
            onClick={() => alignSelected('bottom')}
            title="Align Bottom"
          />
        </>
      )}

      <Separator orientation="vertical" className="h-8" />

      {/* Group/Ungroup */}
      {hasMultipleSelection && !isGroup && (
        <IconButton
          icon={<Group className="w-4 h-4" />}
          onClick={groupSelected}
          title="Group (Cmd/Ctrl+G)"
        />
      )}
      {isGroup && (
        <IconButton
          icon={<Ungroup className="w-4 h-4" />}
          onClick={() => {
            if (selectedElement?.type === 'group') {
              ungroup(selectedElement.id);
            }
          }}
          title="Ungroup (Cmd/Ctrl+Shift+G)"
        />
      )}

      <div className="flex-1" />

      {/* Export */}
      <Button
        variant="default"
        size="sm"
        onClick={onExportPng}
        className="h-9"
      >
        <Download className="w-4 h-4 mr-2" />
        Export PNG
      </Button>
    </div>
  );
}


