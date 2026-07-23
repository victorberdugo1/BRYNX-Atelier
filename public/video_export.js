// ============================================================================
// VideoExportJS - export a canvas to a downloadable media file
// - MP4/WebM: browser MediaRecorder stream capture
// - PNG sequence: frame-by-frame PNG export with alpha preserved (split into
//   multiple ZIP parts so long recordings don't blow up browser memory)
// - MOV alpha: frame-by-frame PNG -> QuickTime MOV via ffmpeg.wasm, encoded
//   in small batches ("segments") and concatenated at the end. This keeps
//   memory bounded regardless of how many total frames are captured.
// ============================================================================

(function () {
  'use strict';

  // Tuning: how many frames live in memory / in ffmpeg's virtual FS at once.
  // Lower = safer for long recordings, higher = fewer ffmpeg invocations.
  const FRAMES_PER_SEGMENT = 90;
  const FRAMES_PER_ZIP_PART = 1000;

  let g_canvas = null;
  let g_stream = null;
  let g_mediaRecorder = null;
  let g_recordedChunks = [];
  let g_isRecording = false;
  let g_exportFormat = 'webm';
  let g_frameRate = 24;
  let g_ffmpegReady = false;
  let g_ffmpegModule = null;
  let g_jsZipPromise = null;

  // mov-alpha streaming (ffmpeg ready during capture)
  let g_streamToFFmpeg = false;
  let g_batchFrameCount = 0;   // frames written in the current segment batch
  let g_segmentCount = 0;      // completed segment .mov files
  let g_frameWriteFailures = 0;

  // fallback paths (ffmpeg not ready during capture, or png-sequence export)
  let g_frameBlobs = [];
  let g_zipPartIndex = 0;
  let g_zipPartFrameOffset = 0;

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

  // mkdir() is a no-op if the directory already exists, so stray files left
  // over from a previous export (aborted mid-way, cancelled, or a failed
  // batch) would otherwise stick around. Since ffmpeg's image2 demuxer reads
  // frame_%04d.png sequentially until it hits a gap, leftover higher-numbered
  // frames from an earlier session would get spliced into the next export.
  // Wipe the directory contents before every new recording to guarantee a
  // clean slate.
  function clearFFmpegDir(Module, dirPath) {
    try {
      const entries = Module.FS.readdir(dirPath);
      for (const entry of entries) {
        if (entry === '.' || entry === '..') continue;
        try {
          Module.FS.unlink(`${dirPath}/${entry}`);
        } catch (error) {
          // ignore individual failures, best effort
        }
      }
    } catch (error) {
      // directory might not exist yet, that's fine
    }
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
        g_batchFrameCount = 0;
        g_segmentCount = 0;
        g_frameWriteFailures = 0;
        g_zipPartIndex = 0;
        g_zipPartFrameOffset = 0;
        g_streamToFFmpeg = g_exportFormat === 'mov-alpha' && g_ffmpegReady && !!g_ffmpegModule;

        if (g_streamToFFmpeg) {
          try { g_ffmpegModule.FS.mkdir('/frames'); } catch (error) { /* already exists */ }
          try { g_ffmpegModule.FS.mkdir('/segments'); } catch (error) { /* already exists */ }
          clearFFmpegDir(g_ffmpegModule, '/frames');
          clearFFmpegDir(g_ffmpegModule, '/segments');
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
          g_ffmpegModule.FS.writeFile(framePath, data);
          g_batchFrameCount += 1;

          if (g_batchFrameCount >= FRAMES_PER_SEGMENT) {
            await this._flushBatchToSegment();
          }
        } catch (error) {
          g_frameWriteFailures += 1;
          console.error('[VideoExport] frame write to ffmpeg FS failed, skipping frame', error);
        }
        return;
      }

      // png-sequence, or mov-alpha fallback when ffmpeg wasn't ready at start
      g_frameBlobs.push(blob);

      if (g_exportFormat === 'png-sequence' && g_frameBlobs.length >= FRAMES_PER_ZIP_PART) {
        await this._flushZipPart();
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

      if (g_streamToFFmpeg && g_ffmpegModule) {
        clearFFmpegDir(g_ffmpegModule, '/frames');
        clearFFmpegDir(g_ffmpegModule, '/segments');
      }

      this._cleanup();
      console.log('[VideoExport] recording cancelled');
    },

    finishEncoder: async function (filename) {
      if (g_exportFormat === 'png-sequence') {
        if (g_frameBlobs.length) {
          await this._flushZipPart(filename);
        }
        if (g_zipPartIndex === 0) {
          console.error('[VideoExport] no frames were captured for PNG sequence');
        }
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

        if (g_ffmpegReady && g_ffmpegModule) {
          try {
            await this._convertBlobsToMov(filename);
          } catch (error) {
            console.error('[VideoExport] MOV alpha export failed, falling back to PNG ZIP', error);
            await this._flushZipPart(filename);
          }
        } else {
          await this._flushZipPart(filename);
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
      // source's actual fps fixes both the fps metadata and the duration.
      let finalBlob = rawBlob;
      let finalMimeType = mimeType;

      if (g_ffmpegReady && g_ffmpegModule) {
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
    // how MediaRecorder timed the original frames.
    _fixFrameRateMetadata: async function (blob, sourceMimeType, filename) {
      const Module = g_ffmpegModule;
      const inputExt = sourceMimeType && sourceMimeType.includes('mp4') ? 'mp4' : 'webm';
      const wantsMp4 = g_exportFormat === 'mp4';
      const outputExt = wantsMp4 ? 'mp4' : 'webm';
      const inputPath = `/fpsfix_input.${inputExt}`;
      const outputPath = `/fpsfix_output.${outputExt}`;

      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        Module.FS.writeFile(inputPath, data);

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

        const ret = Module.exec(...args);
        if (ret !== 0) {
          throw new Error(`ffmpeg fps fix returned ${ret}`);
        }

        const outData = Module.FS.readFile(outputPath);
        const outMimeType = wantsMp4 ? 'video/mp4' : 'video/webm';
        return new Blob([outData], { type: outMimeType });
      } finally {
        try { Module.FS.unlink(inputPath); } catch (error) { /* best effort */ }
        try { Module.FS.unlink(outputPath); } catch (error) { /* best effort */ }
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

    // Zips whatever is currently in g_frameBlobs and downloads it as one part,
    // then clears the array. Called periodically during capture (png-sequence)
    // and once more at finish for any remainder. This bounds memory to
    // FRAMES_PER_ZIP_PART frames instead of holding the whole recording.
    _flushZipPart: async function (filename) {
      if (!g_frameBlobs.length) return;

      const framesToZip = g_frameBlobs;
      g_frameBlobs = [];
      const startIndex = g_zipPartFrameOffset;
      g_zipPartFrameOffset += framesToZip.length;

      try {
        const JSZip = await loadJsZip();
        const baseName = baseNameOf(filename);
        const zip = new JSZip();
        for (let i = 0; i < framesToZip.length; i += 1) {
          const frameName = `${baseName}_${String(startIndex + i).padStart(5, '0')}.png`;
          zip.file(frameName, framesToZip[i]);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        g_zipPartIndex += 1;
        const partSuffix = g_zipPartIndex > 1 || g_exportFormat === 'png-sequence'
          ? `_part${String(g_zipPartIndex).padStart(3, '0')}`
          : '';
        this._downloadBlob(zipBlob, `${baseName}${partSuffix}.zip`);
      } catch (error) {
        console.error('[VideoExport] ZIP part export failed, those frames were lost', error);
      }
    },

    // Encodes whatever PNG frames currently sit in /frames into a new segment
    // .mov file, then deletes them from the virtual FS. Called every
    // FRAMES_PER_SEGMENT frames during capture and once more at finish for
    // any remainder. This bounds ffmpeg's memory use regardless of total
    // recording length.
    _flushBatchToSegment: async function () {
      if (g_batchFrameCount === 0) return;

      const Module = g_ffmpegModule;
      const frameCount = g_batchFrameCount;
      const segmentName = `segment_${String(g_segmentCount).padStart(4, '0')}.mov`;

      try {
        const args = [
          '-framerate', String(g_frameRate),
          '-i', '/frames/frame_%04d.png',
          '-c:v', 'png',
          '-pix_fmt', 'rgba',
          '-f', 'mov',
          '-y', `/segments/${segmentName}`
        ];

        const ret = Module.exec(...args);
        if (ret !== 0) {
          throw new Error(`ffmpeg segment encode returned ${ret}`);
        }

        g_segmentCount += 1;
      } catch (error) {
        console.error('[VideoExport] segment encode failed, this batch of frames was lost', error);
      } finally {
        for (let i = 0; i < frameCount; i += 1) {
          try {
            Module.FS.unlink(`/frames/frame_${String(i).padStart(4, '0')}.png`);
          } catch (error) {
            // best effort cleanup
          }
        }
        g_batchFrameCount = 0;
      }
    },

    // Joins all completed segment .mov files into the final output using
    // ffmpeg's concat demuxer with stream copy (no re-encoding needed since
    // every segment shares the same codec/params).
    _concatSegments: async function (filename) {
      const Module = g_ffmpegModule;
      const outputName = filename && filename.endsWith('.mov') ? filename : `${baseNameOf(filename)}.mov`;

      try {
        if (g_segmentCount === 1) {
          const data = Module.FS.readFile('/segments/segment_0000.mov');
          this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), outputName);
        } else {
          let listContent = '';
          for (let i = 0; i < g_segmentCount; i += 1) {
            listContent += `file 'segment_${String(i).padStart(4, '0')}.mov'\n`;
          }
          Module.FS.writeFile('/segments/list.txt', listContent);

          const args = [
            '-f', 'concat',
            '-safe', '0',
            '-i', '/segments/list.txt',
            '-c', 'copy',
            '-y', '/output.mov'
          ];

          const ret = Module.exec(...args);
          if (ret !== 0) {
            throw new Error(`ffmpeg concat returned ${ret}`);
          }

          const data = Module.FS.readFile('/output.mov');
          this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), outputName);
        }
      } catch (error) {
        console.error('[VideoExport] segment concat failed, downloading segments individually instead', error);
        const baseName = baseNameOf(filename);
        for (let i = 0; i < g_segmentCount; i += 1) {
          try {
            const data = Module.FS.readFile(`/segments/segment_${String(i).padStart(4, '0')}.mov`);
            this._downloadBlob(new Blob([data], { type: 'video/quicktime' }), `${baseName}_part${String(i + 1).padStart(3, '0')}.mov`);
          } catch (innerError) {
            console.error(`[VideoExport] could not read segment ${i}`, innerError);
          }
        }
      } finally {
        try {
          for (let i = 0; i < g_segmentCount; i += 1) {
            Module.FS.unlink(`/segments/segment_${String(i).padStart(4, '0')}.mov`);
          }
          Module.FS.unlink('/segments/list.txt');
          Module.FS.unlink('/output.mov');
        } catch (error) {
          // best effort cleanup
        }
      }
    },

    // Used only when ffmpeg wasn't ready during capture (so all frames ended
    // up as blobs in g_frameBlobs) but became ready by the time finishEncoder
    // runs. Feeds those blobs through the same batched segment pipeline
    // instead of writing them all to the FS at once.
    _convertBlobsToMov: async function (filename) {
      const Module = g_ffmpegModule;
      try { Module.FS.mkdir('/frames'); } catch (error) { /* already exists */ }
      try { Module.FS.mkdir('/segments'); } catch (error) { /* already exists */ }
      clearFFmpegDir(Module, '/frames');
      clearFFmpegDir(Module, '/segments');

      g_batchFrameCount = 0;
      g_segmentCount = 0;
      let usable = 0;

      for (let i = 0; i < g_frameBlobs.length; i += 1) {
        try {
          const data = new Uint8Array(await g_frameBlobs[i].arrayBuffer());
          const framePath = `/frames/frame_${String(g_batchFrameCount).padStart(4, '0')}.png`;
          Module.FS.writeFile(framePath, data);
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
      g_frameWriteFailures = 0;
      g_zipPartIndex = 0;
      g_zipPartFrameOffset = 0;
    }
  };

  window.VideoExportJS = VideoExportJS;

  initFFmpeg().catch(() => {
    // init is best effort; failures fall back to PNG ZIP for MOV alpha exports
  });
})();
