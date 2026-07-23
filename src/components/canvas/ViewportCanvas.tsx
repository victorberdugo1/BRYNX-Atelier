import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { wasmBridge } from "@/lib/wasmBridge";
import { MockRenderer } from "@/lib/mockRenderer";

function containerPixelSize(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return { width: Math.round(rect.width * dpr), height: Math.round(rect.height * dpr) };
}

export function ViewportCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MockRenderer | null>(null);
  // Native render resolution. Normally tracks the container's CSS size (see
  // the ResizeObserver below); while a video is loaded it's pinned to the
  // video's own pixel dimensions instead, so the full frame renders — and
  // every effect, which samples g_sceneTarget at whatever size it was
  // drawn at — covers the whole thing instead of a cropped/stretched slice.
  const videoDimsRef = useRef<{ width: number; height: number } | null>(null);

  const activeEffect = useAppStore((s) => s.activeEffect);
  const params = useAppStore((s) => s.paramsByEffect[s.activeEffect]);
  const setStats = useAppStore((s) => s.setStats);
  const videoFrames = useAppStore((s) => s.video.frames);

  // attach once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      if (videoDimsRef.current) return; // video drives resolution while active
      const { width, height } = containerPixelSize(canvas);
      canvas.width = width;
      canvas.height = height;
      wasmBridge.setCanvasSize(width, height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let disposed = false;
    wasmBridge.attach(canvas).then((mode) => {
      if (disposed) return;
      if (mode === "mock") {
        const renderer = new MockRenderer(canvas);
        renderer.setStatsListener(setStats);
        renderer.setEffect(useAppStore.getState().activeEffect, useAppStore.getState().paramsByEffect[useAppStore.getState().activeEffect]);
        renderer.start();
        rendererRef.current = renderer;
      } else {
        wasmBridge.onStats(setStats);
        // The module just booted at its fixed startup resolution — sync it
        // to whatever the canvas is already sized to (container, or video
        // if one finished loading before attach resolved).
        wasmBridge.setCanvasSize(canvas.width, canvas.height);
      }
    });

    return () => {
      disposed = true;
      ro.disconnect();
      rendererRef.current?.stop();
      rendererRef.current = null;
      wasmBridge.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push param/effect changes to whichever backend is active
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setEffect(activeEffect, params);
    } else {
      wasmBridge.updateParams(activeEffect, params);
    }
  }, [activeEffect, params]);

  // when a video is loaded/cleared, size the canvas to the video's native
  // resolution (or back to the container's, once cleared) and hand the
  // frames to whichever backend is active so the effect samples the video
  // instead of the synthetic startup scene (mock reads ImageBitmaps
  // directly; wasm decodes them to RGBA8)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    videoDimsRef.current =
      videoFrames && videoFrames.length > 0
        ? { width: videoFrames[0].width, height: videoFrames[0].height }
        : null;

    const dims = videoDimsRef.current ?? containerPixelSize(canvas);
    canvas.width = dims.width;
    canvas.height = dims.height;
    wasmBridge.setCanvasSize(dims.width, dims.height);

    rendererRef.current?.setSourceFrames(videoFrames);
    wasmBridge.setVideoFrames(videoFrames);
  }, [videoFrames]);

  // once video frames are active, drive the sampled frame from the shared
  // timeline (play/pause/scrub) instead of the renderer's own free-running clock
  useEffect(() => {
    let lastFrame = -1;
    const unsubscribe = useAppStore.subscribe((state) => {
      const renderer = rendererRef.current;
      const cf = state.timeline.currentFrame;
      if (cf === lastFrame) return;

      if (renderer?.hasSourceFrames) {
        lastFrame = cf;
        renderer.setSourceFrameIndex(cf);
      } else if (wasmBridge.hasVideoFrames) {
        lastFrame = cf;
        wasmBridge.setVideoFrameIndex(cf);
      }
    });
    return unsubscribe;
  }, []);

  return <canvas ref={canvasRef} id="canvas" className="h-full w-full" />;
}
