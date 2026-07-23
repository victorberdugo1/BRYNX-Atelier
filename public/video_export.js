// ============================================================================
// VideoExportJS - export a canvas to a downloadable media file
// - MP4/WebM: browser MediaRecorder stream capture. FPS/duration metadata is
//   fixed up afterwards by re-muxing through ffmpeg.wasm — which runs inside
//   ffmpeg-worker.js, off the main thread, so this never freezes the page.
// - PNG sequence: frame-by-frame PNG export with alpha preserved. All frames
//   go into one folder inside one ZIP, named uniquely per export so repeated
//   exports never collide or land as loose files in Downloads.
// - MOV alpha: frame-by-frame PNG -> QuickTime MOV (qtrle, alpha-preserving)
//   via ffmpeg.wasm, encoded in small batches ("segments") in the worker and
//   concatenated at the end. Keeps memory bounded and the UI responsive
//   regardless of how many total frames are captured.
// ============================================================================

(function () {
  'use strict';

  // Tuning: how many frames live in the worker's virtual FS at once.
  // Lower = safer for long recordings, higher = fewer ffmpeg invocations.
  const FRAMES_PER_SEGMENT = 90;

  let g_canvas = null;
  let g_stream = null;
  let g_mediaRecorder = null;
  let g_recordedChunks = [];
  let g_isRecording = false;
  let g_exportFormat = 'webm';
  let g_frameRate = 24;
  let g_jsZipPromise = null;
  let g_exportStamp = '';

  // mov-alpha streaming (ffmpeg ready during capture)
  let g_streamToFFmpeg = false;
  let g_batchFrameCount = 0;   // frames written in the current segment batch
  let g_segmentCount = 0;      // completed segment .mov files

  // fallback paths (ffmpeg not ready during capture, or png-sequence export)
  let g_frameBlobs = [];

  // ----------------------------------------------------------------------
  // ffmpeg worker client — every ffmpeg operation goes through this. None
  // of it runs on the main thread, so a slow/large encode never freezes the
  // page, and cancelRecording() can hard-abort it via worker.terminate().
  // ----------------------------------------------------------------------
  let g_worker = null;
  let g_ffmpegReady = false;
  let g_ffmpegInitPromise = null;
  let g_msgId = 0;
  const g_pending = new Map();

  function getWorker() {
    if (g_worker) return g_worker;
    g_worker = new Worker('/ffmpeg-worker.js');
    g_worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const pending = g_pending.get(id);
      if (!pending) return;
      g_pending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error));
    };
    g_worker.onerror = (event) => {
      console.error('[VideoExport] ffmpeg worker error', event.message || event);
    };
    return g_worker;
  }

  function workerCall(type, payload, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++g_msgId;
      g_pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, type, payload }, transfer || []);
    });
  }

  // Fire-and-forget probe: spins up the worker and confirms ffmpeg.wasm
  // actually loaded there. Safe to call repeatedly — memoized.
  function ensureFFmpeg() {
    if (g_ffmpegInitPromise) return g_ffmpegInitPromise;
    g_ffmpegInitPromise = workerCall('ping', {})
      .then(() => {
        g_ffmpegReady = true;
        return true;
      })
      .catch((error) => {
        console.warn('[VideoExport] ffmpeg worker unavailable, falling back to raw capture / PNG ZIP', error);
        g_ffmpegReady = false;
        return false;
      });
    return g_ffmpegInitPromise;
  }

  // Hard-abort: kills the worker outright (even mid-exec, which a message
  // could never interrupt) and lets the next export spin up a fresh one.
  function terminateWorker() {
    if (g_worker) {
      g_worker.terminate();
      g_worker = null;
    }
    g_ffmpegReady = false;
    g_ffmpegInitPromise = null;
    g_pending.forEach((p) => p.reject(new Error('ffmpeg worker terminated')));
    g_pending.clear();
  }

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

  function baseNameOf(filename) {
    return (filename || 'export').replace(/\.[^.]+$/, '');
  }

  // Unique per-export stamp (down to the second) so repeated exports of the
  // same format never overwrite/collide — each gets its own folder/file name.
  function makeExportStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

  const VideoExportJS = {
    startEncoder: async function (width, height, fps, format) {
      g_exportFormat = format || 'webm';
      g_frameRate = fps || 24;
      g_recordedChunks = [];
      g_frameBlobs = [];
      g_canvas = getCanvas();
      g_exportStamp = makeExportStamp();

      if (!g_canvas) {
        console.error('[VideoExport] No canvas available for recording');
        return false;
      }

      if (g_exportFormat === 'png-sequence' || g_exportFormat === 'mov-alpha') {
        g_isRecording = true;
        g_batchFrameCount = 0;
        g_segmentCount = 0;

        g_streamToFFmpeg = false;
        if (g_exportFormat === 'mov-alpha') {
          const ready = await ensureFFmpeg();
          g_streamToFFmpeg = ready;
          if (ready) {
            await workerCall('mkdir', { path: '/frames' });
            await workerCall('mkdir', { path: '/segments' });
            await workerCall('cleardir', { path: '/frames' });
            await workerCall('cleardir', { path: '/segments' });
          }
        }

        console.log(`[VideoExport] frame export started (${width}x${height}, ${g_frameRate}fps, ${g_exportFormat}${g_streamToFFmpeg ? ', batched-ffmpeg-segments' : ''})`);
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

      // Kick off the ffmpeg worker in the background so it's (hopefully)
      // ready by the time finishEncoder wants to fix fps/duration metadata.
      ensureFFmpeg();

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

      let blob;
      try {
        blob = await new Promise((resolve, reject) => {
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
      } catch (error) {
        console.error('[VideoExport] frame capture failed', error);
        return;
      }

      if (g_exportFormat === 'mov-alpha' && g_streamToFFmpeg) {
        try {
          const data = new Uint8Array(await blob.arrayBuffer());
          const framePath = `/frames/frame_${String(g_batchFrameCount).padStart(4, '0')}.png`;
          await workerCall('writeFile', { path: framePath, data }, [data.buffer]);
          g_batchFrameCount += 1;

          if (g_batchFrameCount >= FRAMES_PER_SEGMENT) {
            await this._flushBatchToSegment();
          }
        } catch (error) {
          console.error('[VideoExport] frame write to ffmpeg worker failed, skipping frame', error);
        }
        return;
      }

      // png-sequence, or mov-alpha fallback when ffmpeg wasn't ready at start
      g_frameBlobs.push(blob);
    },

    cancelRecording: function () {
      if (g_mediaRecorder && g_mediaRecorder.state !== 'inactive') {
        try {
          g_mediaRecorder.stop();
        } catch (error) {
          console.warn('[VideoExport] cancelRecording failed', error);
        }
      }

      // Hard-kill the worker: this is what makes Cancel actually work even
      // while an ffmpeg encode/exec is mid-flight — a plain message could
      // never interrupt that, but terminating the worker thread can.
      terminateWorker();

      this._cleanup();
      console.log('[VideoExport] recording cancelled');
    },

    finishEncoder: async function (filename) {
      if (g_exportFormat === 'png-sequence') {
        await this._finishPngZip(filename);
        this._cleanup();
        return;
      }

      if (g_exportFormat === 'mov-alpha') {
        if (g_streamToFFmpeg) {
          await this._flushBatchToSegment();

          if (g_segmentCount === 0) {
            console.error('[VideoExport] no frames were captured for MOV alpha');
            this._cleanup();
            return;
          }

          await this._concatSegments(filename);
          this._cleanup();
          return;
        }

        if (!g_frameBlobs.length) {
          console.error('[VideoExport] no frames were captured for MOV alpha');
          this._cleanup();
          return;
        }

        const ready = await ensureFFmpeg();
        if (ready) {
          try {
            await this._convertBlobsToMov(filename);
          } catch (error) {
            console.error('[VideoExport] MOV alpha export failed, falling back to PNG ZIP', error);
            await this._finishPngZip(filename);
          }
        } else {
          await this._finishPngZip(filename);
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
      const rawBlob = new Blob(g_recordedChunks, { type: mimeType });
      g_recordedChunks = [];

      if (!rawBlob.size) {
        console.error('[VideoExport] no media chunks were captured');
        this._cleanup();
        return;
      }

      // MediaRecorder captures at a variable frame rate based on when frames
      // actually arrive, so the container it produces doesn't reliably carry
      // the intended fps/duration metadata. Apps that re-transcode the file
      // (WhatsApp, Instagram, etc.) then guess a default fps instead of the
      // real one. Re-mux through ffmpeg forcing constant frame rate at the
      // source's actual fps fixes both — and since this runs in the worker,
      // it can take as long as it needs without freezing the page.
      let finalBlob = rawBlob;
      let finalMimeType = mimeType;

      const ready = await ensureFFmpeg();
      if (ready) {
        try {
          finalBlob = await this._fixFrameRateMetadata(rawBlob, mimeType, filename);
          finalMimeType = finalBlob.type;
        } catch (error) {
          console.error('[VideoExport] could not fix fps/duration metadata, downloading raw capture instead', error);
          finalBlob = rawBlob;
          finalMimeType = mimeType;
        }
      } else {
        console.warn('[VideoExport] ffmpeg not ready, downloading raw capture (fps/duration metadata may be inaccurate)');
      }

      const downloadName = resolveDownloadName(filename, finalMimeType);
      this._downloadBlob(finalBlob, downloadName);
      this._cleanup();
    },

    // Re-encodes the raw MediaRecorder output at a constant frame rate equal
    // to g_frameRate (the fps of the source video that was loaded), so the
    // exported file's fps and duration metadata are correct regardless of
    // how MediaRecorder timed the original frames. Runs entirely in the
    // ffmpeg worker — never touches the main thread.
    _fixFrameRateMetadata: async function (blob, sourceMimeType, filename) {
      const inputExt = sourceMimeType && sourceMimeType.includes('mp4') ? 'mp4' : 'webm';
      const wantsMp4 = g_exportFormat === 'mp4';
      const outputExt = wantsMp4 ? 'mp4' : 'webm';
      const inputPath = `/fpsfix_input.${inputExt}`;
      const outputPath = `/fpsfix_output.${outputExt}`;

      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        await workerCall('writeFile', { path: inputPath, data }, [data.buffer]);

        const args = wantsMp4
          ? [
              '-i', inputPath,
              '-r', String(g_frameRate),
              '-vsync', 'cfr',
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '18',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-movflags', '+faststart',
              '-y', outputPath
            ]
          : [
              '-i', inputPath,
              '-r', String(g_frameRate),
              '-vsync', 'cfr',
              '-c:v', 'libvpx-vp9',
              '-crf', '30',
              '-b:v', '0',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'libopus',
              '-y', outputPath
            ];

        const ret = await workerCall('exec', { args });
        if (ret !== 0) {
          throw new Error(`ffmpeg fps fix returned ${ret}`);
        }

        const outData = await workerCall('readFile', { path: outputPath });
        const outMimeType = wantsMp4 ? 'video/mp4' : 'video/webm';
        return new Blob([outData], { type: outMimeType });
      } finally {
        workerCall('unlink', { path: inputPath }).catch(() => {});
        workerCall('unlink', { path: outputPath }).catch(() => {});
      }
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

    // Zips every captured PNG frame into ONE folder inside ONE zip file, so
    // Downloads only ever gets a single, organized file per export — never a
    // pile of loose PNGs or numbered zip parts. The folder/zip name carries
    // a timestamp, so a repeat export never collides with a previous one.
    _finishPngZip: async function (filename) {
      if (!g_frameBlobs.length) {
        console.error('[VideoExport] no frames were captured for PNG sequence');
        return;
      }

      const framesToZip = g_frameBlobs;
      g_frameBlobs = [];

      try {
        const JSZip = await loadJsZip();
        const baseName = baseNameOf(filename);
        const folderName = `${baseName}_${g_exportStamp}`;
        const zip = new JSZip();
        const folder = zip.folder(folderName);
        for (let i = 0; i < framesToZip.length; i += 1) {
          const frameName = `${baseName}_${String(i).padStart(5, '0')}.png`;
          folder.file(frameName, framesToZip[i]);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        this._downloadBlob(zipBlob, `${folderName}.zip`);
      } catch (error) {
        console.error('[VideoExport] ZIP export failed, those frames were lost', error);
      }
    },

    // Encodes whatever PNG frames currently sit in /frames (in the worker's
    // FS) into a new segment .mov file, then deletes them. Called every
    // FRAMES_PER_SEGMENT frames during capture and once more at finish for
    // any remainder. Bounds memory regardless of total recording length, and
    // — since it runs in the worker — never blocks the page while it runs.
    _flushBatchToSegment: async function () {
      if (g_batchFrameCount === 0) return;

      const segmentName = `segment_${String(g_segmentCount).padStart(4, '0')}.mov`;

      try {
        const args = [
          '-framerate', String(g_frameRate),
          '-i', '/frames/frame_%04d.png',
          '-c:v', 'qtrle',
          '-pix_fmt', 'argb',
          '-f', 'mov',
          '-y', `/segments/${segmentName}`
        ];

        const ret = await workerCall('exec', { args });
        if (ret !== 0) {
          throw new Error(`ffmpeg segment encode returned ${ret}`);
        }

        g_segmentCount += 1;
      } catch (error) {
        console.error('[VideoExport] segment encode failed, this batch of frames was lost', error);
      } finally {
        await workerCall('cleardir', { path: '/frames' }).catch(() => {});
        g_batchFrameCount = 0;
      }
    },

    // Joins all completed segment .mov files into the final output using
    // ffmpeg's concat demuxer with stream copy (no re-encoding needed since
    // every segment shares the same codec/params).
    _concatSegments: async function (filename) {
      const outputName = filename && filename.endsWith('.mov') ? filename : `${baseNameOf(filename)}.mov`;

      try {
        if (g_segmentCount === 1) {
          const data = await workerCall('readFile', { path: '/segments/segment_0000.mov' });
          this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), outputName);
        } else {
          let listContent = '';
          for (let i = 0; i < g_segmentCount; i += 1) {
            listContent += `file 'segment_${String(i).padStart(4, '0')}.mov'\n`;
          }
          const listData = new TextEncoder().encode(listContent);
          await workerCall('writeFile', { path: '/segments/list.txt', data: listData }, [listData.buffer]);

          const args = [
            '-f', 'concat',
            '-safe', '0',
            '-i', '/segments/list.txt',
            '-c', 'copy',
            '-y', '/output.mov'
          ];

          const ret = await workerCall('exec', { args });
          if (ret !== 0) {
            throw new Error(`ffmpeg concat returned ${ret}`);
          }

          const data = await workerCall('readFile', { path: '/output.mov' });
          this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), outputName);
        }
      } catch (error) {
        console.error('[VideoExport] segment concat failed, downloading segments individually instead', error);
        const baseName = baseNameOf(filename);
        for (let i = 0; i < g_segmentCount; i += 1) {
          try {
            const data = await workerCall('readFile', { path: `/segments/segment_${String(i).padStart(4, '0')}.mov` });
            this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), `${baseName}_part${String(i + 1).padStart(3, '0')}.mov`);
          } catch (innerError) {
            console.error(`[VideoExport] could not read segment ${i}`, innerError);
          }
        }
      } finally {
        await workerCall('cleardir', { path: '/segments' }).catch(() => {});
        await workerCall('unlink', { path: '/output.mov' }).catch(() => {});
      }
    },

    // Used only when ffmpeg wasn't ready during capture (so all frames ended
    // up as blobs in g_frameBlobs) but became ready by the time finishEncoder
    // runs. Feeds those blobs through the same batched segment pipeline
    // instead of writing them all to the worker FS at once.
    _convertBlobsToMov: async function (filename) {
      await workerCall('mkdir', { path: '/frames' });
      await workerCall('mkdir', { path: '/segments' });
      await workerCall('cleardir', { path: '/frames' });
      await workerCall('cleardir', { path: '/segments' });

      g_batchFrameCount = 0;
      g_segmentCount = 0;
      let usable = 0;

      for (let i = 0; i < g_frameBlobs.length; i += 1) {
        try {
          const data = new Uint8Array(await g_frameBlobs[i].arrayBuffer());
          const framePath = `/frames/frame_${String(g_batchFrameCount).padStart(4, '0')}.png`;
          await workerCall('writeFile', { path: framePath, data }, [data.buffer]);
          g_batchFrameCount += 1;
          usable += 1;

          if (g_batchFrameCount >= FRAMES_PER_SEGMENT) {
            await this._flushBatchToSegment();
          }
        } catch (error) {
          console.error(`[VideoExport] frame ${i} could not be read (skipped)`, error);
        }
      }
      g_frameBlobs = [];

      await this._flushBatchToSegment();

      if (g_segmentCount === 0) {
        throw new Error('No frames could be converted to MOV');
      }
      if (usable === 0) {
        throw new Error('No frames were usable');
      }

      await this._concatSegments(filename);
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
      g_streamToFFmpeg = false;
      g_batchFrameCount = 0;
      g_segmentCount = 0;
    }
  };

  window.VideoExportJS = VideoExportJS;
})();
