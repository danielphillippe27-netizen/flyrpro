/**
 * Editor State Store (Zustand)
 * 
 * Centralized state management for the editor with all actions.
 */

import { create } from 'zustand';
import type {
  EditorState,
  EditorElement,
  EditorPage,
  EditorStateSnapshot,
} from './types';
import {
  createSnapshot,
  applySnapshot,
  pushHistory,
  getUndoSnapshot,
  getRedoSnapshot,
  canUndo,
  canRedo,
} from './history';
import { generateId, alignElements } from './utils';
import { getTemplateById } from './templates';

/**
 * Get initial editor state with default page
 */
function getInitialEditorState(): EditorState {
  const pageId = generateId();
  const page: EditorPage = {
    id: pageId,
    name: 'Page 1',
    width: 1200,
    height: 1600,
    backgroundColor: '#ffffff',
    elementIds: [],
  };
  
  return {
    pages: { [pageId]: page },
    currentPageId: pageId,
    elements: {},
    selectedIds: [],
    hoveredId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    isDraggingCanvas: false,
    history: {
      past: [],
      future: [],
    },
  };
}

interface EditorStore extends EditorState {
  // Selection actions
  setSelectedIds: (ids: string[]) => void;
  selectSingle: (id: string) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setHoveredId: (id: string | null) => void;
  
  // Element actions
  addElement: (element: EditorElement) => void;
  updateElement: (id: string, partial: Partial<EditorElement>) => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;
  duplicateElement: (id: string) => void;
  
  // Z-index actions
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  moveZIndex: (id: string, direction: 'up' | 'down') => void;
  
  // Viewport actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (containerWidth: number, containerHeight: number) => void;
  setPan: (x: number, y: number) => void;
  startCanvasPan: () => void;
  endCanvasPan: () => void;
  
  // Group actions
  groupSelected: () => string | null;
  ungroup: (groupId: string) => void;
  
  // Alignment actions
  alignSelected: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  
  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  
  // Template actions
  applyTemplate: (templateId: string) => void;
  
  // Reset
  reset: () => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...getInitialEditorState(),
  
  // Selection actions
  setSelectedIds: (ids: string[]) => {
    set({ selectedIds: ids });
  },
  
  selectSingle: (id: string) => {
    set({ selectedIds: [id] });
  },
  
  toggleSelect: (id: string) => {
    const { selectedIds } = get();
    if (selectedIds.includes(id)) {
      set({ selectedIds: selectedIds.filter((sid) => sid !== id) });
    } else {
      set({ selectedIds: [...selectedIds, id] });
    }
  },
  
  clearSelection: () => {
    set({ selectedIds: [] });
  },
  
  setHoveredId: (id: string | null) => {
    set({ hoveredId: id });
  },
  
  // Element actions
  addElement: (element: EditorElement) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const newElements = { ...state.elements, [element.id]: element };
    const newElementIds = [...page.elementIds, element.id];
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({
      elements: newElements,
      pages: newPages,
      selectedIds: [element.id],
    });
    
    get().pushHistory();
  },
  
  updateElement: (id: string, partial: Partial<EditorElement>) => {
    const state = get();
    const element = state.elements[id];
    if (!element) return;
    
    const updated = { ...element, ...partial };
    set({
      elements: {
        ...state.elements,
        [id]: updated,
      },
    });
  },
  
  removeElement: (id: string) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const { [id]: removed, ...remainingElements } = state.elements;
    const newElementIds = page.elementIds.filter((eid) => eid !== id);
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    // Remove from selection
    const newSelectedIds = state.selectedIds.filter((sid) => sid !== id);
    
    set({
      elements: remainingElements,
      pages: newPages,
      selectedIds: newSelectedIds,
    });
    
    get().pushHistory();
  },
  
  removeElements: (ids: string[]) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const newElements = { ...state.elements };
    const newElementIds = page.elementIds.filter((eid) => !ids.includes(eid));
    
    ids.forEach((id) => {
      delete newElements[id];
    });
    
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    const newSelectedIds = state.selectedIds.filter((sid) => !ids.includes(sid));
    
    set({
      elements: newElements,
      pages: newPages,
      selectedIds: newSelectedIds,
    });
    
    get().pushHistory();
  },
  
  duplicateElement: (id: string) => {
    const state = get();
    const element = state.elements[id];
    if (!element) return;
    
    const newId = generateId();
    const duplicated: EditorElement = {
      ...element,
      id: newId,
      name: `${element.name} Copy`,
      x: element.x + 20,
      y: element.y + 20,
    };
    
    get().addElement(duplicated);
  },
  
  // Z-index actions
  bringToFront: (id: string) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const newElementIds = [...page.elementIds.filter((eid) => eid !== id), id];
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({ pages: newPages });
    get().pushHistory();
  },
  
  sendToBack: (id: string) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const newElementIds = [id, ...page.elementIds.filter((eid) => eid !== id)];
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({ pages: newPages });
    get().pushHistory();
  },
  
  moveZIndex: (id: string, direction: 'up' | 'down') => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const index = page.elementIds.indexOf(id);
    if (index === -1) return;
    
    const newElementIds = [...page.elementIds];
    
    if (direction === 'up' && index < newElementIds.length - 1) {
      [newElementIds[index], newElementIds[index + 1]] = [
        newElementIds[index + 1],
        newElementIds[index],
      ];
    } else if (direction === 'down' && index > 0) {
      [newElementIds[index], newElementIds[index - 1]] = [
        newElementIds[index - 1],
        newElementIds[index],
      ];
    }
    
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({ pages: newPages });
    get().pushHistory();
  },
  
  // Viewport actions
  setZoom: (zoom: number) => {
    const clamped = Math.max(0.1, Math.min(4, zoom));
    set({ zoom: clamped });
  },
  
  zoomIn: () => {
    const { zoom } = get();
    get().setZoom(zoom * 1.2);
  },
  
  zoomOut: () => {
    const { zoom } = get();
    get().setZoom(zoom / 1.2);
  },
  
  zoomToFit: (containerWidth: number, containerHeight: number) => {
    const state = get();
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const scaleX = (containerWidth - 100) / page.width;
    const scaleY = (containerHeight - 100) / page.height;
    const newZoom = Math.min(scaleX, scaleY, 1);
    
    get().setZoom(newZoom);
    get().setPan(0, 0);
  },
  
  setPan: (x: number, y: number) => {
    set({ panX: x, panY: y });
  },
  
  startCanvasPan: () => {
    set({ isDraggingCanvas: true });
  },
  
  endCanvasPan: () => {
    set({ isDraggingCanvas: false });
  },
  
  // Group actions
  groupSelected: () => {
    const state = get();
    if (state.selectedIds.length < 2) return null;
    
    const page = state.pages[state.currentPageId];
    if (!page) return null;
    
    // Calculate group bounds
    const selectedElements = state.selectedIds
      .map((id) => state.elements[id])
      .filter(Boolean) as EditorElement[];
    
    if (selectedElements.length === 0) return null;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    selectedElements.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });
    
    const groupId = generateId();
    const group: EditorElement = {
      id: groupId,
      type: 'group',
      name: 'Group',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      childIds: state.selectedIds,
    };
    
    // Update child positions relative to group
    const newElements = { ...state.elements };
    selectedElements.forEach((el) => {
      newElements[el.id] = {
        ...el,
        x: el.x - minX,
        y: el.y - minY,
      };
    });
    newElements[groupId] = group;
    
    // Update page elementIds
    const remainingIds = page.elementIds.filter((id) => !state.selectedIds.includes(id));
    const newElementIds = [...remainingIds, groupId];
    
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({
      elements: newElements,
      pages: newPages,
      selectedIds: [groupId],
    });
    
    get().pushHistory();
    return groupId;
  },
  
  ungroup: (groupId: string) => {
    const state = get();
    const group = state.elements[groupId];
    if (!group || group.type !== 'group') return;
    
    const page = state.pages[state.currentPageId];
    if (!page) return;
    
    const { [groupId]: removed, ...remainingElements } = state.elements;
    const newElements = { ...remainingElements };
    
    // Restore child positions to absolute coordinates
    group.childIds.forEach((childId) => {
      const child = newElements[childId];
      if (child) {
        newElements[childId] = {
          ...child,
          x: child.x + group.x,
          y: child.y + group.y,
        };
      }
    });
    
    // Update page elementIds
    const groupIndex = page.elementIds.indexOf(groupId);
    const newElementIds = [
      ...page.elementIds.slice(0, groupIndex),
      ...group.childIds,
      ...page.elementIds.slice(groupIndex + 1),
    ];
    
    const newPages = {
      ...state.pages,
      [state.currentPageId]: {
        ...page,
        elementIds: newElementIds,
      },
    };
    
    set({
      elements: newElements,
      pages: newPages,
      selectedIds: group.childIds,
    });
    
    get().pushHistory();
  },
  
  // Alignment actions
  alignSelected: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const state = get();
    if (state.selectedIds.length < 2) return;
    
    const selectedElements = state.selectedIds
      .map((id) => state.elements[id])
      .filter(Boolean) as EditorElement[];
    
    const updates = alignElements(selectedElements, alignment);
    
    const newElements = { ...state.elements };
    Object.entries(updates).forEach(([id, { x, y }]) => {
      if (newElements[id]) {
        newElements[id] = { ...newElements[id], x, y };
      }
    });
    
    set({ elements: newElements });
    get().pushHistory();
  },
  
  // History actions
  pushHistory: () => {
    const state = get();
    const snapshot = createSnapshot(state);
    const newHistory = pushHistory(state.history, snapshot);
    set({ history: newHistory });
  },
  
  undo: () => {
    const state = get();
    if (!canUndo(state.history)) return;
    
    const { snapshot, newHistory } = getUndoSnapshot(state.history);
    if (!snapshot) return;
    
    const newState = applySnapshot(state, snapshot);
    set({
      ...newState,
      history: newHistory,
    });
  },
  
  redo: () => {
    const state = get();
    if (!canRedo(state.history)) return;
    
    const { snapshot, newHistory } = getRedoSnapshot(state.history);
    if (!snapshot) return;
    
    const newState = applySnapshot(state, snapshot);
    set({
      ...newState,
      history: newHistory,
    });
  },
  
  canUndo: () => {
    return canUndo(get().history);
  },
  
  canRedo: () => {
    return canRedo(get().history);
  },
  
  // Template actions
  applyTemplate: (templateId: string) => {
    const template = getTemplateById(templateId);
    if (!template) return;
    
    const snapshot = createSnapshot(get());
    const newHistory = pushHistory(get().history, snapshot);
    
    const newState = applySnapshot(get(), template);
    set({
      ...newState,
      history: newHistory,
    });
  },
  
  // Reset
  reset: () => {
    set(getInitialEditorState());
  },
}));

