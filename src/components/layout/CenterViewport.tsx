import { ViewportCanvas } from "@/components/canvas/ViewportCanvas";
import { useAppStore, type ZoomMode } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { ExportPanel } from "@/components/layout/ExportPanel";
import { Download } from "lucide-react";
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

  const scale = zoom === "fit" ? 1 : Number(zoom) / 100;

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
        </div>
      </div>
    </div>
  );
}
