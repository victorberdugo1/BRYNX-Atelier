import { useAppStore } from "@/store/useAppStore";
import { formatTime } from "@/lib/utils";

export function BottomTimeline() {
  const timeline = useAppStore((s) => s.timeline);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);

  const totalFrames = Math.round(timeline.durationSeconds * timeline.fps);
  const currentSeconds = timeline.currentFrame / timeline.fps;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-panel px-3">
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
