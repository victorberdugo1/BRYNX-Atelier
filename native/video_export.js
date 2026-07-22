// ============================================================================
// VideoExportJS - Grabación de canvas a MP4 usando MediaRecorder + FFmpeg.wasm
// Usa el core directamente (ffmpeg-core.js) sin la capa FFmpeg
// ============================================================================

(function() {
    'use strict';

    let g_stream = null;
    let g_mediaRecorder = null;
    let g_recordedChunks = [];
    let g_isRecording = false;
    let g_ffmpegReady = false;
    let g_ffmpegModule = null;
    let g_exportFormat = 'mp4';
    let g_frameBlobs = [];
    let g_frameRate = 24;
    let g_jsZipPromise = null;

    // ========================================================================
    // CARGA DEL CORE DE FFMPEG
    // ========================================================================

    function loadCoreScript() {
        return new Promise((resolve, reject) => {
            if (typeof createFFmpegCore !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/ffmpeg/ffmpeg-core.js';
            script.onload = () => {
                console.log('[VideoExport] ffmpeg-core.js cargado');
                let attempts = 0;
                const interval = setInterval(() => {
                    if (typeof createFFmpegCore !== 'undefined') {
                        clearInterval(interval);
                        console.log('[VideoExport] createFFmpegCore detectado');
                        resolve();
                    } else if (++attempts > 300) {
                        clearInterval(interval);
                        reject(new Error('Timeout esperando createFFmpegCore'));
                    }
                }, 100);
            };
            script.onerror = () => {
                reject(new Error('Error al cargar ffmpeg-core.js'));
            };
            document.head.appendChild(script);
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
            script.onerror = () => reject(new Error('Error al cargar JSZip'));
            document.head.appendChild(script);
        });
        return g_jsZipPromise;
    }

    async function initFFmpeg() {
        try {
            await loadCoreScript();

            if (typeof createFFmpegCore !== 'function') {
                throw new Error('createFFmpegCore no es una función');
            }

            console.log('[VideoExport] Inicializando FFmpeg core...');
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
            console.log('[VideoExport] ✓ FFmpeg core cargado correctamente');
            return true;
        } catch (err) {
            console.error('[VideoExport] Error al cargar FFmpeg core:', err);
            g_ffmpegReady = false;
            return false;
        }
    }

    // ========================================================================
    // VIDEO EXPORT API
    // ========================================================================

    const VideoExportJS = {
        startEncoder: function(width, height, fps, format) {
            g_exportFormat = format || 'mp4';
            g_frameRate = fps || 24;
            g_frameBlobs = [];
            console.log(`[VideoExport] startEncoder(${width}x${height}, ${fps}fps, ${g_exportFormat})`);
            g_isRecording = true;
            try {
                if (window.Module && typeof window.Module.ccall === 'function') {
                    window.Module.ccall('js_start_export', 'void', ['number', 'number', 'number'], [width, height, fps]);
                }
            } catch (err) {
                console.warn('[VideoExport] js_start_export no disponible, continuando con el estado JS', err);
            }
            console.log(`[VideoExport] Modo de exportación: ${g_exportFormat}`);
        },

        captureFrame: async function() {
            if (g_exportFormat !== 'png-sequence' && g_exportFormat !== 'mov-alpha' && g_exportFormat !== 'mp4' && g_exportFormat !== 'webm') {
                return;
            }

            const canvas = document.getElementById('canvas') || window.Module?.canvas;
            if (!canvas) {
                console.error('[VideoExport] No canvas encontrado para capturar');
                return;
            }

            try {
                await new Promise((resolve) => requestAnimationFrame(() => resolve()));
                const blob = await new Promise((resolve, reject) => {
                    if (typeof canvas.toBlob === 'function') {
                        canvas.toBlob((b) => {
                            if (b) resolve(b);
                            else reject(new Error('Canvas capture failed'));
                        }, 'image/png');
                        return;
                    }
                    reject(new Error('canvas.toBlob is not available'));
                });
                g_frameBlobs.push(blob);
                if (g_frameBlobs.length <= 2) {
                    console.log(`[VideoExport] Frame ${g_frameBlobs.length} captured: ${blob.size} bytes`);
                }
            } catch (err) {
                console.error('[VideoExport] captureFrame failed:', err);
            }
        },

        cancelRecording: function() {
            console.log('[VideoExport] cancelRecording()');
            if (!g_isRecording) {
                console.warn('[VideoExport] No hay grabación activa que cancelar');
                return;
            }
            g_isRecording = false;
            try {
                if (g_mediaRecorder && g_mediaRecorder.state !== 'inactive') {
                    g_mediaRecorder.stop();
                }
            } catch (e) {}
            this._cleanup();
            console.log('[VideoExport] ✓ Grabación cancelada (sin descarga)');
        },

        finishEncoder: async function(filename) {
            console.log('[VideoExport] finishEncoder()');
            
            try {
                if (window.Module && typeof window.Module.ccall === 'function') {
                    window.Module.ccall('js_stop_export', 'void', [], []);
                }
            } catch (err) {
                console.warn('[VideoExport] js_stop_export no disponible', err);
            }
            
            if (!g_isRecording) {
                console.warn('[VideoExport] No hay grabación activa');
                return;
            }
            
            g_isRecording = false;

            if (g_exportFormat === 'png-sequence') {
                if (g_frameBlobs.length === 0) {
                    console.error('[VideoExport] No hay frames capturados para PNG sequence');
                    this._cleanup();
                    return;
                }
                await this._downloadPngSequence(filename);
                this._cleanup();
                return;
            }

            if (g_exportFormat === 'mov-alpha') {
                if (g_frameBlobs.length === 0) {
                    console.error('[VideoExport] No hay frames capturados para MOV alpha');
                    this._cleanup();
                    return;
                }
                await this._convertToMov(filename);
                this._cleanup();
                return;
            }

            if (g_exportFormat === 'mp4') {
                if (g_frameBlobs.length === 0) {
                    console.error('[VideoExport] No hay frames capturados para MP4');
                    this._cleanup();
                    return;
                }
                await this._convertFramesToMp4(filename);
                this._cleanup();
                return;
            }
            
            await new Promise((resolve, reject) => {
                g_mediaRecorder.onstop = () => {
                    resolve();
                };
                
                g_mediaRecorder.onerror = e => {
                    reject(e.error || e);
                };
                
                g_mediaRecorder.requestData();
                
                setTimeout(() => {
                    try {
                        g_mediaRecorder.stop();
                    } catch(e) {}
                }, 0);
            });

            const blob = new Blob(g_recordedChunks, {
                type: g_mediaRecorder.mimeType || "video/webm"
            });
            
            console.log("[VideoExport] Chunks:", g_recordedChunks.length);
            console.log("[VideoExport] Blob:", blob.size);
            
            if (blob.size === 0) {
                console.error("[VideoExport] Blob vacío");
                this._cleanup();
                return;
            }
            
            console.log(`[VideoExport] WebM grabado: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
            
            if (g_ffmpegReady && g_ffmpegModule) {
                await this._convertToMP4(blob, filename);
            } else {
                console.log('[VideoExport] FFmpeg no disponible, descargando como WebM');
                const webmName = filename.replace('.mp4', '.webm');
                this._downloadBlob(blob, webmName);
            }
            
            this._cleanup();
        },

        _convertToMP4: async function(webmBlob, filename) {
            try {
                if (!g_ffmpegReady || !g_ffmpegModule) {
                    throw new Error('FFmpeg no listo');
                }
                
                const Module = g_ffmpegModule;
                
                console.log('[VideoExport] Convirtiendo a MP4...');
                const webmData = new Uint8Array(await webmBlob.arrayBuffer());
                
                console.log("[VideoExport] Input:", webmData.length);
                
                if (webmData.length === 0)
                    throw new Error("input.webm vacío");
                
                Module.FS.writeFile('/input.webm', webmData);
                
                const args = [
                    '-i', '/input.webm',
                    '-c:v', 'mpeg4',
                    '-pix_fmt', 'yuv420p',
                    '-an',
                    '-f', 'mp4',
                    '/output.mp4'
                ];
                
                const ret = Module.exec(...args);
                if (ret !== 0) {
                    throw new Error(`FFmpeg retornó código ${ret}`);
                }
                
                const data = Module.FS.readFile('/output.mp4');
                const mp4Blob = new Blob([data], { type: 'video/mp4' });
                console.log(`[VideoExport] ✓ MP4 generado: ${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`);
                
                this._downloadBlob(mp4Blob, filename);
                
                try {
                    Module.FS.unlink('/input.webm');
                    Module.FS.unlink('/output.mp4');
                } catch (e) {}
                
            } catch (err) {
                console.error('[VideoExport] Error en conversión MP4:', err);
                console.log('[VideoExport] Fallback a WebM');
                const webmName = filename.replace('.mp4', '.webm');
                this._downloadBlob(webmBlob, webmName);
            }
        },

        _downloadBlob: function(blob, filename) {
            try {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.style.display = 'none';
                document.body.appendChild(link);
                console.log(`[VideoExport] Iniciando descarga: ${filename}`);
                link.click();
                console.log('[VideoExport] ✓ Descargado');
                setTimeout(() => {
                    if (link.parentNode) link.parentNode.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 2000);
            } catch (e) {
                console.error('[VideoExport] Error en descarga:', e);
            }
        },

        _downloadPngSequence: async function(filename) {
            try {
                const JSZip = await loadJsZip();
                const baseName = (filename || 'export').replace(/\.[^.]+$/, '');
                const zip = new JSZip();
                for (let i = 0; i < g_frameBlobs.length; i++) {
                    const frameName = `${baseName}_${String(i).padStart(4, '0')}.png`;
                    zip.file(frameName, g_frameBlobs[i]);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
                this._downloadBlob(zipBlob, `${baseName}.zip`);
            } catch (err) {
                console.error('[VideoExport] Error en ZIP PNG:', err);
                const baseName = (filename || 'export').replace(/\.[^.]+$/, '');
                for (let i = 0; i < g_frameBlobs.length; i++) {
                    const frameName = `${baseName}_${String(i).padStart(4, '0')}.png`;
                    this._downloadBlob(g_frameBlobs[i], frameName);
                }
            }
        },

        _convertFramesToMp4: async function(filename) {
            try {
                if (!g_ffmpegReady || !g_ffmpegModule) {
                    throw new Error('FFmpeg no listo');
                }

                const Module = g_ffmpegModule;
                const outputName = filename.endsWith('.mp4') ? filename : `${filename.replace(/\.[^.]+$/, '')}.mp4`;
                try { Module.FS.mkdir('/frames'); } catch (e) {}

                for (let index = 0; index < g_frameBlobs.length; index++) {
                    const framePath = `/frames/frame_${String(index).padStart(4, '0')}.png`;
                    const data = new Uint8Array(await g_frameBlobs[index].arrayBuffer());
                    Module.FS.writeFile(framePath, data);
                }

                const args = [
                    '-framerate', String(g_frameRate),
                    '-i', '/frames/frame_%04d.png',
                    '-c:v', 'mpeg4',
                    '-pix_fmt', 'yuv420p',
                    '-f', 'mp4',
                    '-y', '/output.mp4'
                ];

                const ret = Module.exec(...args);
                if (ret !== 0) {
                    throw new Error(`FFmpeg retornó código ${ret}`);
                }

                const data = Module.FS.readFile('/output.mp4');
                const mp4Blob = new Blob([data], { type: 'video/mp4' });
                console.log(`[VideoExport] ✓ MP4 generado: ${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`);
                this._downloadBlob(mp4Blob, outputName);

                try {
                    for (let index = 0; index < g_frameBlobs.length; index++) {
                        Module.FS.unlink(`/frames/frame_${String(index).padStart(4, '0')}.png`);
                    }
                    Module.FS.unlink('/output.mp4');
                } catch (e) {}
            } catch (err) {
                console.error('[VideoExport] Error en conversión MP4 desde frames:', err);
                this._downloadPngSequence(filename);
            }
        },

        _convertToMov: async function(filename) {
            try {
                if (!g_ffmpegReady || !g_ffmpegModule) {
                    throw new Error('FFmpeg no listo');
                }

                const Module = g_ffmpegModule;
                const outputName = filename.endsWith('.mov') ? filename : `${filename.replace(/\.[^.]+$/, '')}.mov`;

                try {
                    Module.FS.mkdir('/frames');
                } catch (e) {}

                for (let index = 0; index < g_frameBlobs.length; index++) {
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
                    throw new Error(`FFmpeg retornó código ${ret}`);
                }

                const data = Module.FS.readFile('/output.mov');
                const movBlob = new Blob([data], { type: 'video/quicktime' });
                console.log(`[VideoExport] ✓ MOV generado: ${(movBlob.size / 1024 / 1024).toFixed(2)} MB`);
                this._downloadBlob(movBlob, outputName);

                try {
                    for (let index = 0; index < g_frameBlobs.length; index++) {
                        Module.FS.unlink(`/frames/frame_${String(index).padStart(4, '0')}.png`);
                    }
                    Module.FS.unlink('/output.mov');
                } catch (e) {}
            } catch (err) {
                console.error('[VideoExport] Error en conversión MOV:', err);
                this._downloadPngSequence(filename);
            }
        },

        _cleanup: function() {
            if (g_stream) {
                g_stream.getTracks().forEach(t => t.stop());
            }
            g_recordedChunks = [];
            g_mediaRecorder = null;
            g_isRecording = false;
            g_frameBlobs = [];
        }
    };

    window.VideoExportJS = VideoExportJS;

    // ========================================================================
    // INICIALIZACIÓN AUTOMÁTICA
    // ========================================================================

    function initWhenReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initWhenReady);
            return;
        }
        console.log('[VideoExport] Inicializando...');
        initFFmpeg().then(ok => {
            console.log(`[VideoExport] ${ok ? '✓ FFmpeg listo' : '⚠ FFmpeg fallback a WebM'}`);
        });
    }

    initWhenReady();
})();
