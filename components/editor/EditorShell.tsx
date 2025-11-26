'use client';

import { useRef, useEffect } from 'react';
import type Konva from 'konva';
import { CanvasStage } from './CanvasStage';
import { TopToolbar } from './TopToolbar';
import { SidebarLeft } from './SidebarLeft';
import { SidebarRight } from './SidebarRight';
import { LayersPanel } from './LayersPanel';
import { useEditorStore } from '@/lib/editor/state';
import { isInputElement } from '@/lib/editor/konvaHelpers';

export function EditorShell() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const {
    selectedIds,
    removeElements,
    groupSelected,
    ungroup,
    undo,
    redo,
    zoomIn,
    zoomOut,
  } = useEditorStore();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      if (isInputElement(e.target)) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Undo/Redo
      if (cmdOrCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((cmdOrCtrl && e.key === 'z' && e.shiftKey) || (cmdOrCtrl && e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          removeElements(selectedIds);
        }
        return;
      }

      // Group
      if (cmdOrCtrl && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        if (selectedIds.length >= 2) {
          groupSelected();
        }
        return;
      }

      // Ungroup
      if (cmdOrCtrl && e.key === 'g' && e.shiftKey) {
        e.preventDefault();
        const selectedElement = useEditorStore.getState().elements[selectedIds[0]];
        if (selectedElement?.type === 'group') {
          ungroup(selectedElement.id);
        }
        return;
      }

      // Nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          const nudgeAmount = e.shiftKey ? 10 : 1;
          const updates: Record<string, { x: number; y: number }> = {};

          selectedIds.forEach((id) => {
            const element = useEditorStore.getState().elements[id];
            if (!element || element.locked) return;

            let newX = element.x;
            let newY = element.y;

            if (e.key === 'ArrowLeft') newX -= nudgeAmount;
            if (e.key === 'ArrowRight') newX += nudgeAmount;
            if (e.key === 'ArrowUp') newY -= nudgeAmount;
            if (e.key === 'ArrowDown') newY += nudgeAmount;

            updates[id] = { x: newX, y: newY };
          });

          Object.entries(updates).forEach(([id, { x, y }]) => {
            useEditorStore.getState().updateElement(id, { x, y });
          });

          useEditorStore.getState().pushHistory();
        }
        return;
      }

      // Zoom
      if (cmdOrCtrl && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (cmdOrCtrl && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIds, undo, redo, removeElements, groupSelected, ungroup, zoomIn, zoomOut]);

  // Export PNG
  const handleExportPng = () => {
    const stage = stageRef.current;
    if (!stage) {
      alert('Canvas not ready');
      return;
    }

    // Get all layers
    const layers = stage.getLayers();
    
    // Hide guides and transformer layers temporarily
    const guidesLayer = layers[1]; // Guides layer is second
    const transformLayer = layers[3]; // Transform layer is last
    
    const guidesVisible = guidesLayer?.visible();
    const transformVisible = transformLayer?.visible();

    if (guidesLayer) guidesLayer.visible(false);
    if (transformLayer) transformLayer.visible(false);

    // Force redraw
    stage.batchDraw();

    // Export with high resolution
    const dataUrl = stage.toDataURL({
      pixelRatio: 3,
      mimeType: 'image/png',
    });

    // Restore layers
    if (guidesLayer) guidesLayer.visible(guidesVisible ?? true);
    if (transformLayer) transformLayer.visible(transformVisible ?? true);

    // Force redraw again
    stage.batchDraw();

    downloadImage(dataUrl, 'flyr-design.png');
  };

  const downloadImage = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-50 overflow-hidden">
      <TopToolbar onExportPng={handleExportPng} />
      <div className="flex flex-1 overflow-hidden">
        <SidebarLeft />
        <div className="flex-1 flex flex-col" data-canvas-container>
          <div className="flex-1 relative">
            <CanvasStage containerRef={canvasContainerRef} stageRef={stageRef} />
          </div>
        </div>
        <SidebarRight />
      </div>
    </div>
  );
}

