import { useEffect, useRef } from "react";
import type { EffectId } from "@/types/effects";
import { cn } from "@/lib/utils";

interface EffectThumbnailProps {
  effect: EffectId;
  active: boolean;
}

// Lightweight, self-contained animated preview — independent from the main
// viewport renderer so switching effects in the sidebar never touches the
// live preview state.
export function EffectThumbnail({ effect, active }: EffectThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;

    const draw = () => {
      t += 0.02;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#0b0b0e";
      ctx.fillRect(0, 0, w, h);

      if (effect === "ascii") {
        ctx.font = "7px monospace";
        ctx.fillStyle = "#44D4FF";
        const ramp = " .:-=+*#%@";
        for (let y = 0; y < h; y += 8) {
          let line = "";
          for (let x = 0; x < w; x += 5) {
            const v = (Math.sin(x * 0.2 + t) + Math.cos(y * 0.2 + t)) * 0.5 + 0.5;
            line += ramp[Math.floor(v * (ramp.length - 1))] ?? " ";
          }
          ctx.fillText(line, 0, y + 6);
        }
      } else if (effect === "particles") {
        for (let i = 0; i < 40; i++) {
          const a = i * 0.4 + t;
          const r = (i % 10) * (w / 22);
          const x = w / 2 + Math.cos(a) * r * 0.5;
          const y = h - ((t * 20 + i * 6) % h);
          ctx.fillStyle = `rgba(68,212,255,${1 - y / h})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (effect === "crt") {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#1b3a44");
        grad.addColorStop(1, "#0b0b0e");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        ctx.strokeStyle = "#44D4FF";
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * 0.15 + t * 3) * (h * 0.18);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [effect]);

  return (
    <canvas
      ref={canvasRef}
      width={140}
      height={78}
      className={cn(
        "w-full rounded-md border transition-colors",
        active ? "border-accent shadow-[0_0_0_1px_#44D4FF]" : "border-border"
      )}
    />
  );
}
