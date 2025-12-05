/**
 * Layers Hook
 * 
 * Abstraction for reading and manipulating layers in the editor.
 * Provides a clean API for the Layers panel.
 */

import { useEditorStore } from '@/lib/editor/state';
import type { EditorElement } from '@/lib/editor/types';

export type LayerItem = {
  id: string;
  type: 'text' | 'image' | 'rect' | 'circle' | 'qrcode' | 'group' | 'unknown';
  name: string;
  isVisible: boolean;
  isLocked: boolean;
};

export function useLayers() {
  const {
    pages,
    currentPageId,
    elements,
    selectedIds,
    selectSingle,
    updateElement,
    removeElement,
    moveZIndex,
  } = useEditorStore();

  const page = pages[currentPageId];
  if (!page) {
    return {
      layers: [],
      selectLayer: () => {},
      toggleVisibility: () => {},
      toggleLock: () => {},
      deleteLayer: () => {},
      renameLayer: () => {},
      reorderLayers: () => {},
    };
  }

  // Get layers in TOP→BOTTOM order (topmost first)
  // elementIds is stored as back→front, so we reverse it
  const layers: LayerItem[] = [...page.elementIds]
    .reverse()
    .map((id) => {
      const element = elements[id];
      if (!element) return null;
      
      return {
        id: element.id,
        type: element.type === 'text' ? 'text' :
              element.type === 'image' ? 'image' :
              element.type === 'rect' ? 'rect' :
              element.type === 'circle' ? 'circle' :
              element.type === 'qrcode' ? 'qrcode' :
              element.type === 'group' ? 'group' :
              'unknown',
        name: element.name,
        isVisible: element.visible,
        isLocked: element.locked,
      };
    })
    .filter((layer): layer is LayerItem => layer !== null);

  const selectLayer = (id: string) => {
    selectSingle(id);
  };

  const toggleVisibility = (id: string) => {
    const element = elements[id];
    if (!element) return;
    updateElement(id, { visible: !element.visible });
    useEditorStore.getState().pushHistory();
  };

  const toggleLock = (id: string) => {
    const element = elements[id];
    if (!element) return;
    updateElement(id, { locked: !element.locked });
    useEditorStore.getState().pushHistory();
  };

  const deleteLayer = (id: string) => {
    removeElement(id);
    // pushHistory is called in removeElement
  };

  const renameLayer = (id: string, name: string) => {
    updateElement(id, { name });
    useEditorStore.getState().pushHistory();
  };

  const reorderLayers = (sourceIndex: number, destinationIndex: number) => {
    if (!page) return;
    
    // Convert display indices (top→bottom) to storage indices (back→front)
    const reversedElementIds = [...page.elementIds].reverse();
    const sourceId = reversedElementIds[sourceIndex];
    const destinationId = reversedElementIds[destinationIndex];
    
    if (!sourceId || !destinationId) return;
    
    // Find indices in original array (back→front order)
    const originalSourceIndex = page.elementIds.indexOf(sourceId);
    const originalDestIndex = page.elementIds.indexOf(destinationId);
    
    if (originalSourceIndex === -1 || originalDestIndex === -1) return;
    
    // Reorder in back→front order
    const newElementIds = [...page.elementIds];
    const [removed] = newElementIds.splice(originalSourceIndex, 1);
    newElementIds.splice(originalDestIndex, 0, removed);
    
    // Update store
    const newPages = {
      ...pages,
      [currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    useEditorStore.setState({ pages: newPages });
    useEditorStore.getState().pushHistory();
  };

  return {
    layers,
    selectLayer,
    toggleVisibility,
    toggleLock,
    deleteLayer,
    renameLayer,
    reorderLayers,
  };
}

