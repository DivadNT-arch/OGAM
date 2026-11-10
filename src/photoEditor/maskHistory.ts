/**
 * The mask is a list of brush and eraser strokes in normalised image coordinates, so it
 * is independent of screen size, zoom and fold state, and can be drawn at any resolution.
 */
export type StrokeMode = 'brush' | 'erase';

export interface MaskStroke {
  id: string;
  mode: StrokeMode;
  /** Line width as a fraction of the image width. */
  size: number;
  /** Flat list of points: u0, v0, u1, v1, ... */
  points: number[];
}

type Action = { type: 'add'; stroke: MaskStroke } | { type: 'clear'; strokes: MaskStroke[] };

export interface MaskState {
  strokes: MaskStroke[];
  undo: Action[];
  redo: Action[];
}

export const EMPTY_MASK: MaskState = { strokes: [], undo: [], redo: [] };
const MAX_UNDO = 200;

const trim = (a: Action[]) => (a.length > MAX_UNDO ? a.slice(a.length - MAX_UNDO) : a);

export function addStroke(state: MaskState, stroke: MaskStroke): MaskState {
  if (stroke.points.length < 2) return state;
  return { strokes: [...state.strokes, stroke], undo: trim([...state.undo, { type: 'add', stroke }]), redo: [] };
}

export function clearMask(state: MaskState): MaskState {
  if (state.strokes.length === 0) return state;
  return { strokes: [], undo: trim([...state.undo, { type: 'clear', strokes: state.strokes }]), redo: [] };
}

export function undo(state: MaskState): MaskState {
  const action = state.undo[state.undo.length - 1];
  if (!action) return state;
  const strokes = action.type === 'add'
    ? state.strokes.filter(s => s.id !== action.stroke.id)
    : action.strokes;
  return { strokes, undo: state.undo.slice(0, -1), redo: [...state.redo, action] };
}

export function redo(state: MaskState): MaskState {
  const action = state.redo[state.redo.length - 1];
  if (!action) return state;
  const strokes = action.type === 'add' ? [...state.strokes, action.stroke] : [];
  return { strokes, undo: [...state.undo, action], redo: state.redo.slice(0, -1) };
}
