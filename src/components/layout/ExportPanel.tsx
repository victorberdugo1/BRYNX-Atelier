import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/store/useAppStore";
import type { ExportFormat } from "@/types/effects";
import { wasmBridge } from "@/lib/wasmBridge";
import { Download, Film, Image as ImageIcon, Layers, X } from "lucide-react";
import { cn } from "@/lib/utils";

const FORMATS: { id: ExportFormat; label: string; icon: typeof Film; implemented: boolean }[] = [
  { id: "mp4", label: "MP4", icon: Film, implemented: true },
  { id: "webm", label: "WebM", icon: Film, implemented: true },
  { id: "png-sequence", label: "PNG Sequence", icon: ImageIcon, implemented: true },
  { id: "mov-alpha", label: "MOV (Alpha)", icon: Layers, implemented: true },
];

interface ExportPanelProps {
  trigger: React.ReactNode;
}

export function ExportPanel({ trigger }: ExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const exportJob = useAppStore((s) => s.exportJob);
  const startExport = useAppStore((s) => s.startExport);
  const updateExportProgress = useAppStore((s) => s.updateExportProgress);
  const finishExport = useAppStore((s) => s.finishExport);
  const cancelExport = useAppStore((s) => s.cancelExport);
  const timeline = useAppStore((s) => s.timeline);

  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  function clearTimers() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  // stop any in-flight recording if the component unmounts mid-export
  useEffect(() => {
    return () => {
      clearTimers();
      if (useAppStore.getState().exportJob.running) {
        wasmBridge.cancelRecording();
      }
    };
  }, []);

  async function handleStart() {
    const spec = FORMATS.find((f) => f.id === format);
    if (!spec?.implemented) return;

    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      console.error("[ExportPanel] No canvas found to record");
      return;
    }

    const totalFrames = Math.max(1, Math.round(timeline.durationSeconds * timeline.fps));
    const durationMs = timeline.durationSeconds * 1000;

    startExport(format, totalFrames);
    const started = await wasmBridge.startRecording(canvas.width, canvas.height, timeline.fps, format);
    if (!started) {
      cancelExport();
      return;
    }

    const start = performance.now();
    const frameStepMs = Math.max(100, 1000 / Math.max(1, timeline.fps));
    intervalRef.current = window.setInterval(() => {
      if (!useAppStore.getState().exportJob.running) {
        clearTimers();
        return;
      }
      const elapsed = performance.now() - start;
      const frame = Math.min(totalFrames, Math.round((elapsed / durationMs) * totalFrames));
      const eta = Math.max(0, (durationMs - elapsed) / 1000);
      updateExportProgress(frame, eta);
    }, frameStepMs);

    timeoutRef.current = window.setTimeout(async () => {
      clearTimers();
      if (!useAppStore.getState().exportJob.running) return; // cancelled meanwhile
      updateExportProgress(totalFrames, 0);
      const filename = format === "mp4" ? "export.mp4" : format === "webm" ? "export.webm" : format === "mov-alpha" ? "export.mov" : "export.png";
      try {
        await wasmBridge.stopRecording(filename);
      } catch (err) {
        console.error("[ExportPanel] stopRecording failed:", err);
      }
      finishExport();
    }, durationMs);
  }

  function handleCancel() {
    clearTimers();
    wasmBridge.cancelRecording();
    cancelExport();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent>
        <DialogTitle className="text-sm font-semibold">Export</DialogTitle>
        <DialogDescription className="text-[11px] text-muted-foreground">
          Render the current timeline out to a file.
        </DialogDescription>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => f.implemented && setFormat(f.id)}
              disabled={exportJob.running || !f.implemented}
              title={f.implemented ? undefined : "Not implemented yet"}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
                !f.implemented && "cursor-not-allowed opacity-40",
                format === f.id ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-panel-raised"
              )}
            >
              <f.icon className="h-3.5 w-3.5" />
              {f.label}
              {!f.implemented && <span className="ml-auto text-[9px] uppercase text-muted-foreground">Soon</span>}
            </button>
          ))}
        </div>

        {exportJob.running ? (
          <div className="mt-4 space-y-2">
            <Progress value={exportJob.progress} />
            <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground">
              <span>Frame {exportJob.currentFrame}/{exportJob.totalFrames}</span>
              <span>ETA {Math.max(0, Math.round(exportJob.etaSeconds))}s</span>
            </div>
            <Button variant="destructive" size="sm" className="w-full gap-1.5" onClick={handleCancel}>
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="accent"
            size="default"
            className="mt-4 w-full gap-1.5"
            onClick={handleStart}
            disabled={!FORMATS.find((f) => f.id === format)?.implemented}
          >
            <Download className="h-3.5 w-3.5" /> Start Export
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
