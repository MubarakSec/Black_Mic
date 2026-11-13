import {
  FFT_SIZE,
  VISUALIZER_FPS,
  GLOW_VOLUME_THRESHOLD,
  ROLE_SENDER,
} from '../constants';

const MILLISECONDS_PER_SECOND = 1000;
const VISUALIZER_FRAME_INTERVAL_MS = MILLISECONDS_PER_SECOND / VISUALIZER_FPS;
const VISUALIZER_DB_FLOOR = -36;
const VISUALIZER_ORB_BASE_SCALE = 1;
const VISUALIZER_ORB_SCALE_RANGE = 1.3;
const VISUALIZER_ORB_BASE_OPACITY = 0.3;
const VISUALIZER_ORB_OPACITY_RANGE = 0.5;
const VISUALIZER_CANVAS_ACTIVE_THRESHOLD = 5;
const VISUALIZER_BAR_GAP_PX = 2;
const VISUALIZER_CLIP_COLOR = '#ff4d4d';
const VISUALIZER_IDLE_COLOR = '#fff';
const VISUALIZER_SENDER_COLOR = '#00f58c';
const VISUALIZER_RECEIVER_COLOR = '#00d2ff';

/**
 * Starts the direct-DOM/canvas visualizer loop. All mutable state is read
 * and written through refs so this can run at 20fps without re-rendering.
 */
export function startVisualizerLoop({
  analyserRef,
  canvasRef,
  orbRef,
  iconRef,
  vuBarRef,
  vuLabelRef,
  telemetryRef,
  animationRef,
  canvasDimsRef,
  activeRole,
}) {
  if (!analyserRef.current) return;
  analyserRef.current.fftSize = FFT_SIZE;
  analyserRef.current.smoothingTimeConstant = 0.8;
  const bufferLength = analyserRef.current.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const activeColor = activeRole === ROLE_SENDER
    ? VISUALIZER_SENDER_COLOR
    : VISUALIZER_RECEIVER_COLOR;
  const visualState = {
    iconColor: null,
    barColor: null,
    label: null,
    labelColor: null,
    canvasOpacity: null,
  };
  let lastFrameTime = -VISUALIZER_FRAME_INTERVAL_MS;

  const updateVisualizer = (frameTime) => {
    if (!analyserRef.current) return;
    animationRef.current = requestAnimationFrame(updateVisualizer);
    if (document.visibilityState !== 'visible') return;
    if (frameTime - lastFrameTime < VISUALIZER_FRAME_INTERVAL_MS) return;
    lastFrameTime = frameTime;

    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;

    // Direct DOM manipulation of the UI elements for high performance
    if (activeRole === ROLE_SENDER && telemetryRef.current.peakDb !== -100) {
      const t = telemetryRef.current;
      const peakPct = Math.max(
        0,
        Math.min(100, ((t.peakDb - VISUALIZER_DB_FLOOR) / -VISUALIZER_DB_FLOOR) * 100),
      );
      const normalizedPeak = peakPct / 100;
      const isClipped = t.clippedSamples > 0;
      const levelColor = isClipped ? VISUALIZER_CLIP_COLOR : activeColor;

      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${VISUALIZER_ORB_BASE_SCALE + (normalizedPeak * VISUALIZER_ORB_SCALE_RANGE)})`;
        orbRef.current.style.opacity = `${VISUALIZER_ORB_BASE_OPACITY + (normalizedPeak * VISUALIZER_ORB_OPACITY_RANGE)}`;
      }
      if (iconRef.current) {
        if (visualState.iconColor !== levelColor) {
          iconRef.current.style.color = levelColor;
          visualState.iconColor = levelColor;
        }
      }
      if (vuBarRef.current) {
        vuBarRef.current.style.transform = `scaleX(${normalizedPeak})`;
        if (visualState.barColor !== levelColor) {
          vuBarRef.current.style.backgroundColor = levelColor;
          visualState.barColor = levelColor;
        }
      }
      if (vuLabelRef.current) {
        const label = `${t.peakDb.toFixed(1)} dB`;
        if (visualState.label !== label) {
          vuLabelRef.current.textContent = label;
          visualState.label = label;
        }
        const labelColor = isClipped ? VISUALIZER_CLIP_COLOR : VISUALIZER_IDLE_COLOR;
        if (visualState.labelColor !== labelColor) {
          vuLabelRef.current.style.color = labelColor;
          visualState.labelColor = labelColor;
        }
      }
    } else {
      const volumePct = Math.round((average / 255) * 100);
      const normalizedVolume = volumePct / 100;
      const iconColor = average > GLOW_VOLUME_THRESHOLD
        ? activeColor
        : VISUALIZER_IDLE_COLOR;

      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${VISUALIZER_ORB_BASE_SCALE + (normalizedVolume * VISUALIZER_ORB_SCALE_RANGE)})`;
        orbRef.current.style.opacity = `${VISUALIZER_ORB_BASE_OPACITY + (normalizedVolume * VISUALIZER_ORB_OPACITY_RANGE)}`;
      }
      if (iconRef.current) {
        if (visualState.iconColor !== iconColor) {
          iconRef.current.style.color = iconColor;
          visualState.iconColor = iconColor;
        }
      }
      if (vuBarRef.current) {
        vuBarRef.current.style.transform = `scaleX(${normalizedVolume})`;
        if (visualState.barColor !== activeColor) {
          vuBarRef.current.style.backgroundColor = activeColor;
          visualState.barColor = activeColor;
        }
      }
      if (vuLabelRef.current) {
        const label = `${volumePct}%`;
        if (visualState.label !== label) {
          vuLabelRef.current.textContent = label;
          visualState.label = label;
        }
        if (visualState.labelColor !== VISUALIZER_IDLE_COLOR) {
          vuLabelRef.current.style.color = VISUALIZER_IDLE_COLOR;
          visualState.labelColor = VISUALIZER_IDLE_COLOR;
        }
      }
    }

    // Draw real-time frequency visualizer on canvas (resolved lazily each frame)
    const canvas = canvasRef.current;
    const canvasContext = canvas?.getContext('2d');
    if (canvas && canvasContext) {
      if (canvasDimsRef.current.width === 0) {
        canvasDimsRef.current.width = canvas.width;
        canvasDimsRef.current.height = canvas.height;
      }
      const { width, height } = canvasDimsRef.current;
      canvasContext.clearRect(0, 0, width, height);

      const barWidth = width / bufferLength;
      const drawableBarWidth = Math.max(1, barWidth - VISUALIZER_BAR_GAP_PX);
      let x = 0;

      canvasContext.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;
        canvasContext.rect(x, height - barHeight, drawableBarWidth, barHeight);
        x += barWidth;
      }
      canvasContext.fillStyle = activeColor;
      canvasContext.fill();

      const canvasOpacity = average > VISUALIZER_CANVAS_ACTIVE_THRESHOLD ? '1' : '0.2';
      if (visualState.canvasOpacity !== canvasOpacity) {
        canvas.style.opacity = canvasOpacity;
        visualState.canvasOpacity = canvasOpacity;
      }
    }
  };
  animationRef.current = requestAnimationFrame(updateVisualizer);
}
