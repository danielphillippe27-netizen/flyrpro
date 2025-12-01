/**
 * Editor History Management
 * 
 * Handles undo/redo functionality by storing snapshots of editor state.
 */

import type { EditorState, EditorStateSnapshot } from './types';

/**
 * Create a snapshot of the current editor state
 */
export function createSnapshot(state: EditorState): EditorStateSnapshot {
  return {
    pages: { ...state.pages },
    elements: { ...state.elements },
    currentPageId: state.currentPageId,
    selectedIds: [...state.selectedIds],
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
  };
}

/**
 * Apply a snapshot to the editor state
 */
export function applySnapshot(
  state: EditorState,
  snapshot: EditorStateSnapshot
): EditorState {
  return {
    ...state,
    pages: snapshot.pages,
    elements: snapshot.elements,
    currentPageId: snapshot.currentPageId,
    selectedIds: snapshot.selectedIds,
    zoom: snapshot.zoom,
    panX: snapshot.panX,
    panY: snapshot.panY,
  };
}

/**
 * Push current state to history (for undo)
 */
export function pushHistory(
  history: EditorHistory,
  snapshot: EditorStateSnapshot,
  maxHistorySize: number = 50
): EditorHistory {
  const newPast = [...history.past, snapshot];
  
  // Limit history size
  if (newPast.length > maxHistorySize) {
    newPast.shift();
  }
  
  return {
    past: newPast,
    future: [], // Clear future when new action is performed
  };
}

/**
 * Check if undo is possible
 */
export function canUndo(history: EditorHistory): boolean {
  return history.past.length > 0;
}

/**
 * Check if redo is possible
 */
export function canRedo(history: EditorHistory): boolean {
  return history.future.length > 0;
}

/**
 * Get the previous state snapshot for undo
 */
export function getUndoSnapshot(history: EditorHistory): {
  snapshot: EditorStateSnapshot | null;
  newHistory: EditorHistory;
} {
  if (history.past.length === 0) {
    return { snapshot: null, newHistory: history };
  }
  
  const snapshot = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);
  
  return {
    snapshot,
    newHistory: {
      past: newPast,
      future: [snapshot, ...history.future],
    },
  };
}

/**
 * Get the next state snapshot for redo
 */
export function getRedoSnapshot(history: EditorHistory): {
  snapshot: EditorStateSnapshot | null;
  newHistory: EditorHistory;
} {
  if (history.future.length === 0) {
    return { snapshot: null, newHistory: history };
  }
  
  const snapshot = history.future[0];
  const newFuture = history.future.slice(1);
  
  return {
    snapshot,
    newHistory: {
      past: [...history.past, snapshot],
      future: newFuture,
    },
  };
}

// Re-export types for convenience
export type { EditorHistory, EditorStateSnapshot } from './types';


