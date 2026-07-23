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

// Gives the renderer a tick to actually push/paint the new frame before we
// grab the canvas. This used to wait on requestAnimationFrame, but browsers
// fully suspend rAF callbacks while the tab is hidden/backgrounded — which
// froze the export loop the moment the user switched tabs. setTimeout still
// fires (throttled, but never fully stopped) in background tabs, so use it
// instead — this keeps the export progressing while the user works on
// something else.
function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 16));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Best-effort: keeps the display from sleeping mid-export. Has no effect on
// background-tab timer throttling (that's handled by switching off rAF
// above and in the wasm main loop), it only stops the screen itself from
// locking. Silently no-ops if unsupported or if the request is rejected
// (e.g. the tab was already hidden when requested).
async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
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
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const videoFrameCount = useAppStore((s) => s.video.frames?.length ?? 0);

  const runIdRef = useRef(0);

  // stop any in-flight recording if the component unmounts mid-export
  useEffect(() => {
    return () => {
      runIdRef.current += 1; // invalidate any in-flight export loop
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

    const runId = ++runIdRef.current;
    const hasVideo = videoFrameCount > 0;
    const totalFrames = hasVideo
      ? videoFrameCount
      : Math.max(1, Math.round(timeline.durationSeconds * timeline.fps));
    const isSnapshotFormat = format === "png-sequence" || format === "mov-alpha";
    const frameIntervalMs = Math.max(1, 1000 / Math.max(1, timeline.fps));

    startExport(format, totalFrames);
    const started = await wasmBridge.startRecording(canvas.width, canvas.height, timeline.fps, format);
    if (!started) {
      cancelExport();
      return;
    }

    // Freeze the timeline's own playback loop while we drive currentFrame
    // ourselves — otherwise both would fight over it and frames would skip
    // or repeat unpredictably.
    const wasPlaying = timeline.playing;
    if (hasVideo) setPlaying(false);

    // Best-effort: keep the screen from locking mid-export (see
    // requestWakeLock's comment above for what this does and doesn't cover).
    const wakeLock = await requestWakeLock();

    const stillCurrent = () => runIdRef.current === runId && useAppStore.getState().exportJob.running;

    try {
      if (hasVideo) {
        // Deterministic export: step through every imported video frame one
        // by one (independent of real time), so ALL frames get rendered
        // with the effect and captured — not just whatever frame happened
        // to be showing when Export was clicked.
        for (let i = 0; i < totalFrames; i++) {
          if (!stillCurrent()) return;
          setCurrentFrame(i);
          // Give the renderer (wasm module or mock) a couple of paint ticks
          // to actually push the new video texture and draw it before we
          // grab the canvas.
          await nextFrame();
          await nextFrame();
          if (isSnapshotFormat) {
            await wasmBridge.captureFrame();
          } else {
            // mp4/webm: MediaRecorder samples the live canvas stream, so the
            // frame needs to stay on screen long enough to actually get
            // grabbed at the target fps.
            await sleep(frameIntervalMs);
          }
          updateExportProgress(i + 1, ((totalFrames - i - 1) * frameIntervalMs) / 1000);
        }
      } else {
        // No source video: the effect animates on its own real-time clock
        // (particles/CRT/etc. inside the wasm render loop), so just let it
        // run for the timeline's configured duration, snapshotting along
        // the way for the frame-by-frame formats.
        const start = performance.now();
        const durationMs = timeline.durationSeconds * 1000;
        while (performance.now() - start < durationMs) {
          if (!stillCurrent()) return;
          if (isSnapshotFormat) await wasmBridge.captureFrame();
          const elapsed = performance.now() - start;
          const frame = Math.min(totalFrames, Math.round((elapsed / durationMs) * totalFrames));
          updateExportProgress(frame, Math.max(0, (durationMs - elapsed) / 1000));
          await sleep(frameIntervalMs);
        }
      }

      if (!stillCurrent()) return;
      updateExportProgress(totalFrames, 0);
      const filename = format === "mp4" ? "export.mp4" : format === "webm" ? "export.webm" : format === "mov-alpha" ? "export.mov" : "export.png";
      await wasmBridge.stopRecording(filename);
      finishExport();
    } catch (err) {
      console.error("[ExportPanel] export failed:", err);
      if (runIdRef.current === runId) {
        // Make sure any partially-written encoder buffers (ffmpeg FS frames,
        // in-flight MediaRecorder chunks, etc.) are cleared even when the
        // failure happened outside our own try block above, so the next
        // export starts from a clean slate instead of inheriting leftovers.
        wasmBridge.cancelRecording();
        cancelExport();
      }
    } finally {
      if (runIdRef.current === runId) {
        if (hasVideo) setPlaying(wasPlaying);
        // Always rewind the timeline slider to the start once an export
        // ends — whether it finished, failed, or was cancelled — so a new
        // export begins at frame 0 instead of resuming from wherever this
        // one stopped.
        setCurrentFrame(0);
      }
      wakeLock?.release().catch(() => {});
    }
  }

  function handleCancel() {
    runIdRef.current += 1;
    wasmBridge.cancelRecording();
    cancelExport();
    setCurrentFrame(0);
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
