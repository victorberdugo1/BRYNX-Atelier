import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { wasmBridge } from "@/lib/wasmBridge";
import { MockRenderer } from "@/lib/mockRenderer";

export function ViewportCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MockRenderer | null>(null);

  const activeEffect = useAppStore((s) => s.activeEffect);
  const params = useAppStore((s) => s.paramsByEffect[s.activeEffect]);
  const setStats = useAppStore((s) => s.setStats);

  // attach once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
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

  return <canvas ref={canvasRef} id="canvas" className="h-full w-full" />;
}
