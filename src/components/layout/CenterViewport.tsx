import { useCallback, useRef, useState } from "react";
import { ViewportCanvas } from "@/components/canvas/ViewportCanvas";
import { useAppStore, type ZoomMode } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { ExportPanel } from "@/components/layout/ExportPanel";
import { Download, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ZOOM_LEVELS: { id: ZoomMode; label: string }[] = [
  { id: "fit", label: "Fit" },
  { id: "50", label: "50%" },
  { id: "100", label: "100%" },
  { id: "200", label: "200%" },
];

const ZOOM_WHEEL_SENSITIVITY = 0.0015;

export function CenterViewport() {
  const zoom = useAppStore((s) => s.zoom);
  const zoomScale = useAppStore((s) => s.zoomScale);
  const pan = useAppStore((s) => s.pan);
  const setZoom = useAppStore((s) => s.setZoom);
  const setZoomScale = useAppStore((s) => s.setZoomScale);
  const setPan = useAppStore((s) => s.setPan);
  const resetView = useAppStore((s) => s.resetView);
  const stats = useAppStore((s) => s.stats);
  const video = useAppStore((s) => s.video);
  const loadVideo = useAppStore((s) => s.loadVideo);
  const clearVideo = useAppStore((s) => s.clearVideo);
  const activeEffect = useAppStore((s) => s.activeEffect);
  const spawnParams = useAppStore((s) => s.paramsByEffect.particles);
  const setParam = useAppStore((s) => s.setParam);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null); // the overflow:hidden viewport frame
  const transformRef = useRef<HTMLDivElement>(null); // the panned/scaled wrapper (holds the canvas)
  const panDrag = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);
  const spawnDrag = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingSpawn, setIsDraggingSpawn] = useState(false);

  const spawnX = Number(spawnParams.spawnX ?? 0.5);
  const spawnY = Number(spawnParams.spawnY ?? 0.8);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void loadVideo(file);
  };

  // Drag-to-pan: mousedown anywhere on the stage (except the spawn handle,
  // which stops propagation on its own pointerdown) starts tracking; the
  // translate offset is applied in unscaled pixels, so raw client-delta maps
  // 1:1 to pan regardless of the current zoom level.
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    panDrag.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    setIsPanning(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDrag.current) return;
    const dx = e.clientX - panDrag.current.startX;
    const dy = e.clientY - panDrag.current.startY;
    setPan({ x: panDrag.current.startPan.x + dx, y: panDrag.current.startPan.y + dy });
  };

  const endStagePan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDrag.current) return;
    panDrag.current = null;
    setIsPanning(false);
    if ((e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  // Scroll-to-zoom, anchored on the cursor so the point under it stays put:
  // transform is `translate(pan) scale(s)` with a centered origin, so a
  // content point at local coord l shows on screen at pan + s*l. Solving for
  // the new pan that keeps that screen position fixed as s changes gives
  // panNew = mouse*(1-k) + panOld*k, where k = sNew/sOld and `mouse` is the
  // cursor position relative to the stage's center.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - (rect.left + rect.width / 2);
    const my = e.clientY - (rect.top + rect.height / 2);

    const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY);
    const scaleOld = zoomScale;
    const scaleNew = Math.min(8, Math.max(0.1, scaleOld * factor));
    const k = scaleNew / scaleOld;

    setPan({ x: mx * (1 - k) + pan.x * k, y: my * (1 - k) + pan.y * k });
    setZoomScale(scaleNew);
  };

  // Spawn-point handle: dragging it reads the *canvas'* live on-screen
  // bounding rect (already reflecting the current pan/zoom transform) so the
  // fraction math is correct at any zoom level without duplicating the
  // translate/scale math above.
  const updateSpawnFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = transformRef.current?.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const fy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      setParam("particles", "spawnX", Math.round(fx * 100) / 100);
      setParam("particles", "spawnY", Math.round(fy * 100) / 100);
    },
    [setParam],
  );

  const handleSpawnPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    spawnDrag.current = true;
    setIsDraggingSpawn(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateSpawnFromPointer(e.clientX, e.clientY);
  };

  const handleSpawnPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!spawnDrag.current) return;
    e.stopPropagation();
    updateSpawnFromPointer(e.clientX, e.clientY);
  };

  const endSpawnDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!spawnDrag.current) return;
    e.stopPropagation();
    spawnDrag.current = false;
    setIsDraggingSpawn(false);
    if ((e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-[#0d0d10]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-1">
          {ZOOM_LEVELS.map((z) => (
            <Button
              key={z.id}
              size="sm"
              variant={zoom === z.id ? "accent" : "ghost"}
              onClick={() => setZoom(z.id)}
            >
              {z.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={resetView}
            className="text-[10.5px] text-muted-foreground hover:text-foreground"
            title="Restablecer pan y zoom (o doble clic en el visor)"
          >
            Drag to pan · Scroll to zoom · {Math.round(zoomScale * 100)}%
          </button>
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
          {video.frames ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={clearVideo}
              title="Quitar video y volver a la escena de referencia"
            >
              <X className="h-3 w-3" /> Quitar video
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={video.loading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              {video.loading ? `Cargando ${Math.round(video.progress * 100)}%` : "Cargar video"}
            </Button>
          )}
          <ExportPanel
            trigger={
              <Button variant="accent" size="sm" className="gap-1.5">
                <Download className="h-3 w-3" /> Export
              </Button>
            }
          />
        </div>
      </div>

      <div
        ref={stageRef}
        className={cn("relative flex-1 overflow-hidden checker-bg", isPanning ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={endStagePan}
        onPointerLeave={endStagePan}
        onPointerCancel={endStagePan}
        onWheel={handleWheel}
        onDoubleClick={resetView}
      >
        <div
          ref={transformRef}
          className="h-full w-full origin-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomScale})`,
            transition: isPanning ? "none" : "transform 150ms ease-out",
          }}
        >
          <ViewportCanvas />

          {activeEffect === "particles" && (
            <div
              onPointerDown={handleSpawnPointerDown}
              onPointerMove={handleSpawnPointerMove}
              onPointerUp={endSpawnDrag}
              onPointerCancel={endSpawnDrag}
              title="Arrastra para mover el punto de nacimiento de las partículas"
              className={cn(
                "absolute z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border-2 border-accent bg-accent/25 shadow-floating",
                isDraggingSpawn && "border-white bg-accent/50",
              )}
              style={{ left: `${spawnX * 100}%`, top: `${spawnY * 100}%` }}
            >
              <div className="h-1.5 w-1.5 rounded-full bg-accent" />
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/80 bg-panel/85 px-2.5 py-2 font-mono text-[10.5px] leading-4 text-foreground/90 shadow-floating backdrop-blur">
          <div>
            FPS <span className="text-accent">{stats.fps}</span>
          </div>
          <div>
            {stats.resolutionW}×{stats.resolutionH}
          </div>
          <div>Frame {stats.frame}</div>
          <div className="capitalize">Effect: {stats.effect}</div>
          <div>GPU {stats.gpuFrameTimeMs}ms</div>
          {video.frames && <div className="text-accent">Video: {video.frames.length} frames</div>}
        </div>

        {video.error && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-xs rounded-md border border-destructive/50 bg-panel/95 px-2.5 py-2 text-[11px] text-destructive shadow-floating">
            {video.error}
          </div>
        )}
      </div>
    </div>
  );
}
