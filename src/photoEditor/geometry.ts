/** Pure geometry for the edit canvas. Image points are normalised: u, v in 0..1. */

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
/** Zoom/pan applied to the canvas content, scaling around the container centre. */
export interface ViewTransform { scale: number; tx: number; ty: number }

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

/** Largest rect with the image's aspect ratio that fits, centred, inside the container. */
export function fitRect(container: Size, image: Size): Rect {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

/** Maps a touch point (container coords) to a normalised image point. */
export function screenToImage(p: Point, frame: { view: ViewTransform; container: Size; fit: Rect }): Point {
  const { view, container, fit } = frame;
  const cx = container.width / 2;
  const cy = container.height / 2;
  const lx = (p.x - view.tx - cx) / view.scale + cx;
  const ly = (p.y - view.ty - cy) / view.scale + cy;
  return { x: (lx - fit.x) / fit.width, y: (ly - fit.y) / fit.height };
}

/** New translation that keeps the focal point fixed while zooming from one scale to another. */
export function zoomAround(z: { focal: Point; container: Size; from: ViewTransform; nextScale: number }): ViewTransform {
  'worklet';
  const { focal, container, from, nextScale } = z;
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
  const ratio = scale / from.scale;
  const fx = focal.x - container.width / 2;
  const fy = focal.y - container.height / 2;
  return { scale, tx: fx - (fx - from.tx) * ratio, ty: fy - (fy - from.ty) * ratio };
}

/** Keeps the zoomed content from being dragged completely off screen. */
export function clampPan(view: ViewTransform, container: Size): ViewTransform {
  'worklet';
  const maxX = (container.width * (view.scale - 1)) / 2 + container.width * 0.25;
  const maxY = (container.height * (view.scale - 1)) / 2 + container.height * 0.25;
  return {
    scale: view.scale,
    tx: Math.min(maxX, Math.max(-maxX, view.tx)),
    ty: Math.min(maxY, Math.max(-maxY, view.ty)),
  };
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
