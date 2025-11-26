import { create } from 'zustand';
import type { FlyerData, FlyerElement } from '@/lib/flyers/types';

interface FlyerEditorState {
  flyerData: FlyerData;
  selectedElementId: string | null;
  history: {
    past: FlyerData[];
    future: FlyerData[];
  };
}

interface FlyerEditorStore extends FlyerEditorState {
  // Data actions
  setFlyerData: (data: FlyerData) => void;
  setBackgroundColor: (color: string) => void;

  // Element actions
  addElement: (element: FlyerElement) => void;
  updateElement: (id: string, partial: Partial<FlyerElement>) => void;
  deleteElement: (id: string) => void;

  // Selection actions
  setSelectedElementId: (id: string | null) => void;

  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const MAX_HISTORY = 50;

export const useFlyerEditorStore = create<FlyerEditorStore>((set, get) => ({
  flyerData: {
    backgroundColor: '#ffffff',
    elements: [],
  },
  selectedElementId: null,
  history: {
    past: [],
    future: [],
  },

  setFlyerData: (data: FlyerData) => {
    set({ flyerData: data, selectedElementId: null });
    get().pushHistory();
  },

  setBackgroundColor: (color: string) => {
    const { flyerData } = get();
    set({
      flyerData: {
        ...flyerData,
        backgroundColor: color,
      },
    });
    get().pushHistory();
  },

  addElement: (element: FlyerElement) => {
    const { flyerData } = get();
    set({
      flyerData: {
        ...flyerData,
        elements: [...flyerData.elements, element],
      },
      selectedElementId: element.id,
    });
    get().pushHistory();
  },

  updateElement: (id: string, partial: Partial<FlyerElement>) => {
    const { flyerData } = get();
    set({
      flyerData: {
        ...flyerData,
        elements: flyerData.elements.map((el) =>
          el.id === id ? { ...el, ...partial } : el
        ),
      },
    });
  },

  deleteElement: (id: string) => {
    const { flyerData, selectedElementId } = get();
    set({
      flyerData: {
        ...flyerData,
        elements: flyerData.elements.filter((el) => el.id !== id),
      },
      selectedElementId: selectedElementId === id ? null : selectedElementId,
    });
    get().pushHistory();
  },

  setSelectedElementId: (id: string | null) => {
    set({ selectedElementId: id });
  },

  pushHistory: () => {
    const { flyerData, history } = get();
    const newPast = [...history.past, JSON.parse(JSON.stringify(flyerData))];
    
    // Limit history size
    if (newPast.length > MAX_HISTORY) {
      newPast.shift();
    }

    set({
      history: {
        past: newPast,
        future: [], // Clear future when new action is performed
      },
    });
  },

  undo: () => {
    const { flyerData, history } = get();
    if (history.past.length === 0) return;

    const previousState = history.past[history.past.length - 1];
    const newPast = history.past.slice(0, -1);
    const newFuture = [JSON.parse(JSON.stringify(flyerData)), ...history.future];

    set({
      flyerData: previousState,
      history: {
        past: newPast,
        future: newFuture,
      },
      selectedElementId: null,
    });
  },

  redo: () => {
    const { flyerData, history } = get();
    if (history.future.length === 0) return;

    const nextState = history.future[0];
    const newPast = [...history.past, JSON.parse(JSON.stringify(flyerData))];
    const newFuture = history.future.slice(1);

    set({
      flyerData: nextState,
      history: {
        past: newPast,
        future: newFuture,
      },
      selectedElementId: null,
    });
  },

  canUndo: () => {
    return get().history.past.length > 0;
  },

  canRedo: () => {
    return get().history.future.length > 0;
  },
}));

// Export helper for generating IDs
export { generateId };

