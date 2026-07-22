const MAX_FRAMES = 600;
const DEFAULT_FPS = 30;

export interface VideoFrameExtractionResult {
  frames: ImageBitmap[];
  fps: number;
  width: number;
  height: number;
}

/**
 * Espera a que el frame en el tiempo `t` esté realmente decodificado y
 * pintado (no solo a que se dispare "seeked", que puede llegar antes de que
 * el frame esté disponible para drawImage). Usa requestVideoFrameCallback
 * cuando existe; si no, hace fallback a "seeked" + doble rAF.
 */
function seekToFrame(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Error al buscar frame del video"));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onSeeked = () => {
      // Fallback: "seeked" puede llegar antes de que el frame esté pintado,
      // así que se esperan dos rAF extra para asegurar que ya se compuso.
      requestAnimationFrame(() => requestAnimationFrame(finish));
    };

    video.addEventListener("error", onError);

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => finish());
      video.currentTime = t;
      video.addEventListener("seeked", onSeeked); // red de seguridad si rVFC nunca llega
    } else {
      video.addEventListener("seeked", onSeeked);
      video.currentTime = t;
    }
  });
}

/**
 * Extrae hasta 600 frames de un archivo de video como ImageBitmap, usando un
 * <video> mudo y un canvas offscreen. El audio nunca se decodifica ni se
 * reproduce — solo se dibujan frames del elemento de video sobre un canvas
 * (drawImage), así que queda descartado por completo.
 */
export async function extractVideoFrames(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<VideoFrameExtractionResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.src = url;
  // Adjuntarlo al DOM (oculto) es necesario en varios navegadores para que
  // el decodificador entregue frames reales al hacer seek fuera de reproducción.
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        reject(new Error("No se pudo leer el archivo de video"));
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onError);
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error("El video no tiene una duración válida");
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error("El video no tiene dimensiones válidas");
    }

    // "Primea" el decodificador: sin al menos un play/pause real, algunos
    // navegadores nunca entregan frames decodificados a un <video> que solo
    // hace seek, y drawImage termina capturando cuadros negros.
    try {
      await video.play();
      video.pause();
    } catch {
      // Autoplay bloqueado: igual seguimos, el seek + rVFC de abajo suele bastar.
    }
    video.currentTime = 0;
    await seekToFrame(video, 0);

    const fps = DEFAULT_FPS;
    const totalFrames = Math.max(1, Math.min(MAX_FRAMES, Math.floor(duration * fps)));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");

    const frames: ImageBitmap[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const t = Math.min(duration, i / fps);
      await seekToFrame(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      frames.push(bitmap);
      onProgress?.(i + 1, totalFrames);
    }

    return { frames, fps, width, height };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    document.body.removeChild(video);
    URL.revokeObjectURL(url);
  }
}
