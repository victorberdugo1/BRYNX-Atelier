import { Play, Pause, SkipBack } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils";

export function BottomTimeline() {
  const timeline = useAppStore((s) => s.timeline);
  const togglePlay = useAppStore((s) => s.togglePlay);
  const restartTimeline = useAppStore((s) => s.restartTimeline);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const raf = useRef(0);
  const last = useRef(performance.now());

  useEffect(() => {
    const loop = (t: number) => {
      const dt = (t - last.current) / 1000;
      last.current = t;
      const s = useAppStore.getState();
      if (s.timeline.playing) {
        const totalFrames = s.timeline.durationSeconds * s.timeline.fps;
        const next = (s.timeline.currentFrame + dt * s.timeline.fps) % Math.max(1, totalFrames);
        setCurrentFrame(next);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [setCurrentFrame]);

  const totalFrames = Math.round(timeline.durationSeconds * timeline.fps);
  const currentSeconds = timeline.currentFrame / timeline.fps;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-panel px-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={restartTimeline} title="Restart">
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button variant="accent" size="icon" onClick={togglePlay} title={timeline.playing ? "Pause" : "Play"}>
          {timeline.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex flex-1 items-center gap-3">
        <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatTime(currentSeconds)}
        </span>
        <input
          type="range"
          min={0}
          max={totalFrames}
          value={Math.round(timeline.currentFrame)}
          onChange={(e) => setCurrentFrame(Number(e.target.value))}
          className="h-1 w-full flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-accent"
        />
        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {formatTime(timeline.durationSeconds)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-l border-border pl-3 font-mono text-[11px] text-muted-foreground">
        <span>Frame {Math.round(timeline.currentFrame)}/{totalFrames}</span>
        <span>{timeline.fps} FPS</span>
      </div>
    </div>
  );
}
