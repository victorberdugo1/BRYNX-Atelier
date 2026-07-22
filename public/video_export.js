// ============================================================================
// VideoExportJS - export a canvas to a downloadable media file
// - MP4/WebM: browser MediaRecorder stream capture
// - PNG sequence: frame-by-frame PNG export with alpha preserved
// - MOV alpha: frame-by-frame PNG -> QuickTime MOV via ffmpeg.wasm when available
// ============================================================================

(function () {
  'use strict';

  let g_canvas = null;
  let g_stream = null;
  let g_mediaRecorder = null;
  let g_recordedChunks = [];
  let g_isRecording = false;
  let g_exportFormat = 'webm';
  let g_frameRate = 24;
  let g_frameBlobs = [];
  let g_ffmpegReady = false;
  let g_ffmpegModule = null;
  let g_jsZipPromise = null;

  function getCanvas() {
    return document.getElementById('canvas') || window.Module?.canvas || null;
  }

  function pickMimeType(format) {
    const candidates = format === 'mp4'
      ? ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      : ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];

    for (const mimeType of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mimeType)) {
        return mimeType;
      }
    }

    return format === 'mp4' ? 'video/mp4' : 'video/webm';
  }

  function resolveDownloadName(filename, mimeType) {
    const safeName = (filename || 'export').replace(/\s+/g, '-');
    if (mimeType && mimeType.includes('mp4') && !safeName.toLowerCase().endsWith('.mp4')) {
      return `${safeName.replace(/\.[^.]+$/, '')}.mp4`;
    }
    if (mimeType && mimeType.includes('webm') && !safeName.toLowerCase().endsWith('.webm')) {
      return `${safeName.replace(/\.[^.]+$/, '')}.webm`;
    }
    return safeName;
  }

  function loadCoreScript() {
    return new Promise((resolve, reject) => {
      if (typeof createFFmpegCore !== 'undefined') {
        resolve();
        return;
      }

      const candidates = [
        '/ffmpeg/ffmpeg-core.js',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js'
      ];

      const tryLoad = (index) => {
        if (index >= candidates.length) {
          reject(new Error('ffmpeg core script could not be loaded'));
          return;
        }

        const script = document.createElement('script');
        script.src = candidates[index];
        script.onload = () => {
          let attempts = 0;
          const interval = setInterval(() => {
            if (typeof createFFmpegCore !== 'undefined') {
              clearInterval(interval);
              resolve();
            } else if (++attempts > 200) {
              clearInterval(interval);
              reject(new Error('Timed out waiting for createFFmpegCore'));
            }
          }, 100);
        };
        script.onerror = () => tryLoad(index + 1);
        document.head.appendChild(script);
      };

      tryLoad(0);
    });
  }

  function loadJsZip() {
    if (g_jsZipPromise) return g_jsZipPromise;
    g_jsZipPromise = new Promise((resolve, reject) => {
      if (typeof window.JSZip !== 'undefined') {
        resolve(window.JSZip);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => reject(new Error('Error loading JSZip'));
      document.head.appendChild(script);
    });
    return g_jsZipPromise;
  }

  async function initFFmpeg() {
    try {
      await loadCoreScript();
      if (typeof createFFmpegCore !== 'function') {
        throw new Error('createFFmpegCore is not available');
      }

      const module = await createFFmpegCore({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return '/ffmpeg/ffmpeg-core.wasm';
          }
          return path;
        }
      });

      g_ffmpegModule = module;
      g_ffmpegReady = true;
      return true;
    } catch (error) {
      console.warn('[VideoExport] ffmpeg.wasm unavailable, MOV alpha will fall back to a PNG ZIP', error);
      g_ffmpegReady = false;
      return false;
    }
  }

  const VideoExportJS = {
    startEncoder: function (width, height, fps, format) {
      g_exportFormat = format || 'webm';
      g_frameRate = fps || 24;
      g_recordedChunks = [];
      g_frameBlobs = [];
      g_canvas = getCanvas();

      if (!g_canvas) {
        console.error('[VideoExport] No canvas available for recording');
        return false;
      }

      if (g_exportFormat === 'png-sequence' || g_exportFormat === 'mov-alpha') {
        g_isRecording = true;
        console.log(`[VideoExport] frame export started (${width}x${height}, ${g_frameRate}fps, ${g_exportFormat})`);
        return true;
      }

      if (typeof MediaRecorder === 'undefined' || typeof g_canvas.captureStream !== 'function') {
        console.error('[VideoExport] MediaRecorder/captureStream is not available in this browser');
        return false;
      }

      if (g_mediaRecorder && g_mediaRecorder.state !== 'inactive') {
        try {
          g_mediaRecorder.stop();
        } catch (error) {
          console.warn('[VideoExport] previous recorder could not be stopped', error);
        }
      }

      g_stream = g_canvas.captureStream(Math.max(1, g_frameRate));
      const mimeType = pickMimeType(g_exportFormat);
      const recorderOptions = mimeType ? { mimeType } : undefined;

      try {
        g_mediaRecorder = new MediaRecorder(g_stream, recorderOptions);
      } catch (error) {
        console.warn('[VideoExport] falling back to default MediaRecorder options', error);
        g_mediaRecorder = new MediaRecorder(g_stream);
      }

      g_mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          g_recordedChunks.push(event.data);
        }
      };

      g_mediaRecorder.onerror = (event) => {
        console.error('[VideoExport] recorder error', event.error || event);
      };

      g_mediaRecorder.start(100);
      g_isRecording = true;
      console.log(`[VideoExport] recording started (${width}x${height}, ${g_frameRate}fps, ${g_exportFormat}) using ${g_mediaRecorder.mimeType || 'default'}`);
      return true;
    },

    captureFrame: async function () {
      if (!g_isRecording) return;
      if (g_exportFormat !== 'png-sequence' && g_exportFormat !== 'mov-alpha') return;

      const canvas = getCanvas();
      if (!canvas) {
        console.error('[VideoExport] No canvas available for frame capture');
        return;
      }

      try {
        const blob = await new Promise((resolve, reject) => {
          const offscreen = document.createElement('canvas');
          offscreen.width = canvas.width;
          offscreen.height = canvas.height;
          const context = offscreen.getContext('2d');

          if (!context) {
            reject(new Error('2D context unavailable for frame capture'));
            return;
          }

          context.clearRect(0, 0, offscreen.width, offscreen.height);
          context.drawImage(canvas, 0, 0);
          offscreen.toBlob((bitmap) => {
            if (bitmap) resolve(bitmap);
            else reject(new Error('Canvas capture failed'));
          }, 'image/png');
        });

        g_frameBlobs.push(blob);
      } catch (error) {
        console.error('[VideoExport] frame capture failed', error);
      }
    },

    cancelRecording: function () {
      if (g_mediaRecorder && g_mediaRecorder.state !== 'inactive') {
        try {
          g_mediaRecorder.stop();
        } catch (error) {
          console.warn('[VideoExport] cancelRecording failed', error);
        }
      }

      this._cleanup();
      console.log('[VideoExport] recording cancelled');
    },

    finishEncoder: async function (filename) {
      if (g_exportFormat === 'png-sequence') {
        if (!g_frameBlobs.length) {
          console.error('[VideoExport] no frames were captured for PNG sequence');
          this._cleanup();
          return;
        }
        await this._downloadPngSequence(filename);
        this._cleanup();
        return;
      }

      if (g_exportFormat === 'mov-alpha') {
        if (!g_frameBlobs.length) {
          console.error('[VideoExport] no frames were captured for MOV alpha');
          this._cleanup();
          return;
        }
        if (g_ffmpegReady && g_ffmpegModule) {
          await this._convertToMov(filename);
        } else {
          await this._downloadPngSequence(filename);
        }
        this._cleanup();
        return;
      }

      if (!g_isRecording || !g_mediaRecorder) {
        this._cleanup();
        return;
      }

      const recorder = g_mediaRecorder;
      g_mediaRecorder = null;
      g_isRecording = false;

      await new Promise((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = (event) => reject(event.error || event);
        try {
          recorder.stop();
        } catch (error) {
          reject(error);
        }
      });

      const mimeType = recorder.mimeType || 'video/webm';
      const blob = new Blob(g_recordedChunks, { type: mimeType });
      g_recordedChunks = [];

      if (!blob.size) {
        console.error('[VideoExport] no media chunks were captured');
        this._cleanup();
        return;
      }

      const downloadName = resolveDownloadName(filename, mimeType);
      this._downloadBlob(blob, downloadName);
      this._cleanup();
    },

    _downloadBlob: function (blob, filename) {
      try {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          if (link.parentNode) {
            link.parentNode.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 2000);
      } catch (error) {
        console.error('[VideoExport] download failed', error);
      }
    },

    _downloadPngSequence: async function (filename) {
      try {
        const JSZip = await loadJsZip();
        const baseName = (filename || 'export').replace(/\.[^.]+$/, '');
        const zip = new JSZip();
        for (let index = 0; index < g_frameBlobs.length; index += 1) {
          const frameName = `${baseName}_${String(index).padStart(4, '0')}.png`;
          zip.file(frameName, g_frameBlobs[index]);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        this._downloadBlob(zipBlob, `${baseName}.zip`);
      } catch (error) {
        console.error('[VideoExport] PNG ZIP export failed', error);
      }
    },

    _convertToMov: async function (filename) {
      try {
        if (!g_ffmpegReady || !g_ffmpegModule) {
          throw new Error('ffmpeg is not ready');
        }

        const Module = g_ffmpegModule;
        const outputName = filename.endsWith('.mov') ? filename : `${(filename || 'export').replace(/\.[^.]+$/, '')}.mov`;
        try {
          Module.FS.mkdir('/frames');
        } catch (error) {
          // already exists
        }

        for (let index = 0; index < g_frameBlobs.length; index += 1) {
          const framePath = `/frames/frame_${String(index).padStart(4, '0')}.png`;
          const data = new Uint8Array(await g_frameBlobs[index].arrayBuffer());
          Module.FS.writeFile(framePath, data);
        }

        const args = [
          '-framerate', String(g_frameRate),
          '-i', '/frames/frame_%04d.png',
          '-c:v', 'png',
          '-pix_fmt', 'rgba',
          '-f', 'mov',
          '-y', '/output.mov'
        ];

        const ret = Module.exec(...args);
        if (ret !== 0) {
          throw new Error(`ffmpeg returned ${ret}`);
        }

        const data = Module.FS.readFile('/output.mov');
        const movBlob = new Blob([data], { type: 'video/quicktime' });
        this._downloadBlob(movBlob, outputName);

        try {
          for (let index = 0; index < g_frameBlobs.length; index += 1) {
            Module.FS.unlink(`/frames/frame_${String(index).padStart(4, '0')}.png`);
          }
          Module.FS.unlink('/output.mov');
        } catch (error) {
          // cleanup best effort
        }
      } catch (error) {
        console.error('[VideoExport] MOV alpha export failed', error);
        await this._downloadPngSequence(filename);
      }
    },

    _cleanup: function () {
      if (g_stream) {
        g_stream.getTracks().forEach((track) => track.stop());
      }
      g_stream = null;
      g_canvas = null;
      g_mediaRecorder = null;
      g_recordedChunks = [];
      g_frameBlobs = [];
      g_isRecording = false;
    }
  };

  window.VideoExportJS = VideoExportJS;

  initFFmpeg().catch(() => {
    // init is best effort; failures fall back to PNG ZIP for MOV alpha exports
  });
})();
