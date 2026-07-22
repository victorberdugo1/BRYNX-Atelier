import { useRef } from "react";
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

export function CenterViewport() {
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const stats = useAppStore((s) => s.stats);
  const video = useAppStore((s) => s.video);
  const loadVideo = useAppStore((s) => s.loadVideo);
  const clearVideo = useAppStore((s) => s.clearVideo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scale = zoom === "fit" ? 1 : Number(zoom) / 100;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void loadVideo(file);
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
          <span className="text-[10.5px] text-muted-foreground">Drag to pan · Scroll to zoom</span>
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

      <div className="relative flex-1 overflow-hidden checker-bg">
        <div
          className={cn("h-full w-full origin-center transition-transform duration-150")}
          style={{ transform: zoom === "fit" ? undefined : `scale(${scale})` }}
        >
          <ViewportCanvas />
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
