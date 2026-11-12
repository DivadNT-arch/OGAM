import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Mask, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme';
import { clampPan, fitRect, round4, screenToImage, zoomAround, type Size } from '../geometry';
import type { MaskStroke, StrokeMode } from '../maskHistory';
import type { CanvasTool } from '../services/editSession';

interface MaskCanvasProps {
  imageUri: string;
  imageSize: Size;
  strokes: MaskStroke[];
  tool: CanvasTool;
  /** Brush diameter in screen points. */
  brushSize: number;
  /** Hide the mask (used by the press-and-hold before/after view). */
  hideMask?: boolean;
  onStroke: (stroke: MaskStroke) => void;
}

/** SVG user space: image width is always 1000 units, height follows the aspect ratio. */
const VB_W = 1000;
/** Skip touch moves shorter than this many screen points; keeps strokes compact. */
const MIN_STEP = 1.5;

function strokePath(points: number[], vbH: number): string {
  if (points.length < 2) return '';
  let d = `M${points[0] * VB_W} ${points[1] * vbH}`;
  // A tap is a zero-length line, which Android does not draw; nudge it into a dot.
  if (points.length === 2) return `${d} L${points[0] * VB_W + 0.01} ${points[1] * vbH}`;
  for (let i = 2; i < points.length; i += 2) d += ` L${points[i] * VB_W} ${points[i + 1] * vbH}`;
  return d;
}

let strokeCounter = 0;

export const MaskCanvas: React.FC<MaskCanvasProps> = ({
  imageUri, imageSize, strokes, tool, brushSize, hideMask, onStroke,
}) => {
  const { colors } = useTheme();
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 });
  const fit = useMemo(() => fitRect(container, imageSize), [container, imageSize]);
  const vbH = (VB_W * imageSize.height) / Math.max(1, imageSize.width);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pinchLast = useSharedValue(1);
  const panLastX = useSharedValue(0);
  const panLastY = useSharedValue(0);

  // Live stroke: refs hold the truth, state only triggers a redraw.
  const live = useRef<{ mode: StrokeMode; size: number; points: number[]; lastX: number; lastY: number; box?: boolean } | null>(null);
  const ignoreTouch = useRef(false);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Folding/unfolding changes the size: keep the photo and mask, reset the zoom to fit.
    setContainer(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    scale.value = 1; tx.value = 0; ty.value = 0;
  }, [scale, tx, ty]);

  const toImage = useCallback((x: number, y: number) =>
    screenToImage({ x, y }, { view: { scale: scale.value, tx: tx.value, ty: ty.value }, container, fit }),
  [container, fit, scale, tx, ty]);

  const finishStroke = useCallback(() => {
    const s = live.current;
    live.current = null;
    setLivePoints(null);
    if (s && s.points.length >= 2) {
      strokeCounter += 1;
      if (s.box) {
        // Store the box with sorted corners, clamped to the photo.
        const [a, b, c, d] = s.points;
        const pts = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)].map(v => round4(Math.min(1, Math.max(0, v))));
        if (pts[2] - pts[0] > 0.002 && pts[3] - pts[1] > 0.002) {
          onStroke({ id: `${Date.now()}-${strokeCounter}`, mode: 'brush', size: 0, points: pts, shape: 'rect' });
        }
        return;
      }
      onStroke({ id: `${Date.now()}-${strokeCounter}`, mode: s.mode, size: s.size, points: s.points });
    }
  }, [onStroke]);

  const gestures = useMemo(() => {
    const drawing = tool !== 'move';
    const draw = Gesture.Pan()
      .runOnJS(true)
      .enabled(drawing)
      .minDistance(0)
      .onTouchesDown(e => {
        // A second finger means zoom/pan: drop the stroke that the first finger started.
        if (e.numberOfTouches > 1) { ignoreTouch.current = true; live.current = null; setLivePoints(null); }
      })
      .onBegin(e => {
        if (ignoreTouch.current || fit.width === 0) return;
        const p = toImage(e.x, e.y);
        const size = round4(brushSize / (fit.width * scale.value));
        const start = [round4(p.x), round4(p.y)];
        live.current = tool === 'box'
          ? { mode: 'brush', size: 0, points: [...start, ...start], lastX: e.x, lastY: e.y, box: true }
          : { mode: tool === 'erase' ? 'erase' : 'brush', size, points: start, lastX: e.x, lastY: e.y };
        setLivePoints(live.current.points);
      })
      .onUpdate(e => {
        const s = live.current;
        if (!s || ignoreTouch.current) return;
        if (Math.hypot(e.x - s.lastX, e.y - s.lastY) < MIN_STEP) return;
        const p = toImage(e.x, e.y);
        s.points = s.box ? [s.points[0], s.points[1], round4(p.x), round4(p.y)] : [...s.points, round4(p.x), round4(p.y)];
        s.lastX = e.x; s.lastY = e.y;
        setLivePoints(s.points);
      })
      .onFinalize(() => {
        if (!ignoreTouch.current) finishStroke();
        ignoreTouch.current = false;
      });

    const pinch = Gesture.Pinch()
      .onStart(() => { pinchLast.value = 1; })
      .onUpdate(e => {
        const factor = e.scale / pinchLast.value;
        pinchLast.value = e.scale;
        const next = zoomAround({
          focal: { x: e.focalX, y: e.focalY }, container,
          from: { scale: scale.value, tx: tx.value, ty: ty.value }, nextScale: scale.value * factor,
        });
        const c = clampPan(next, container);
        scale.value = c.scale; tx.value = c.tx; ty.value = c.ty;
      });

    const pan = Gesture.Pan()
      .minPointers(drawing ? 2 : 1)
      .onStart(() => { panLastX.value = 0; panLastY.value = 0; })
      .onUpdate(e => {
        const c = clampPan({
          scale: scale.value,
          tx: tx.value + e.translationX - panLastX.value,
          ty: ty.value + e.translationY - panLastY.value,
        }, container);
        panLastX.value = e.translationX; panLastY.value = e.translationY;
        tx.value = c.tx; ty.value = c.ty;
      });

    const resetZoom = Gesture.Tap()
      .numberOfTaps(2)
      .enabled(!drawing)
      .onEnd(() => {
        scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0);
      });

    return Gesture.Simultaneous(draw, pinch, pan, resetZoom);
  }, [tool, brushSize, fit, container, toImage, finishStroke, scale, tx, ty, pinchLast, panLastX, panLastY]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const fitStyle = { left: fit.x, top: fit.y, width: fit.width, height: fit.height };
  const shown: MaskStroke[] = livePoints && live.current
    ? [...strokes, {
      id: 'live', mode: live.current.mode, size: live.current.size, points: livePoints,
      shape: live.current.box ? 'rect' : undefined,
    }]
    : strokes;

  return (
    <GestureDetector gesture={gestures}>
      <View style={styles.container} onLayout={onLayout} testID="photo-editor-canvas" collapsable={false}>
        <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
          {fit.width > 0 && (
            <>
              <Image source={{ uri: `file://${imageUri}` }} style={[styles.abs, fitStyle]} resizeMode="stretch" />
              {!hideMask && shown.length > 0 && (
                <Svg style={[styles.abs, fitStyle]} viewBox={`0 0 ${VB_W} ${vbH}`} pointerEvents="none">
                  <Defs>
                    <Mask id="editMask" maskUnits="userSpaceOnUse" x={0} y={0} width={VB_W} height={vbH}>
                      <Rect x={0} y={0} width={VB_W} height={vbH} fill="black" />
                      {shown.map(s => (s.shape === 'rect' ? (
                        <Rect key={s.id} x={Math.min(s.points[0], s.points[2]) * VB_W} y={Math.min(s.points[1], s.points[3]) * vbH}
                          width={Math.abs(s.points[2] - s.points[0]) * VB_W} height={Math.abs(s.points[3] - s.points[1]) * vbH}
                          fill="white" />
                      ) : (
                        <Path key={s.id} d={strokePath(s.points, vbH)} stroke={s.mode === 'brush' ? 'white' : 'black'}
                          strokeWidth={s.size * VB_W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      )))}
                    </Mask>
                  </Defs>
                  <Rect x={0} y={0} width={VB_W} height={vbH} fill={colors.error} opacity={0.5} mask="url(#editMask)" />
                </Svg>
              )}
            </>
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  abs: { position: 'absolute' },
});
