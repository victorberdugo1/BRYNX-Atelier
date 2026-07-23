// ============================================================================
// ffmpeg-worker.js — runs ffmpeg.wasm inside a dedicated Worker.
// Everything here (loading the core, FS ops, exec) happens off the main
// thread, so no matter how long an encode takes, the page/UI never freezes
// and a terminate() from the main thread can hard-abort it instantly.
// ============================================================================

let g_module = null;

function loadCore() {
  return new Promise((resolve, reject) => {
    if (typeof createFFmpegCore !== 'undefined') {
      resolve();
      return;
    }
    const candidates = [
      '/ffmpeg/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    ];
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        reject(new Error('ffmpeg core script could not be loaded'));
        return;
      }
      const url = candidates[i];
      i += 1;
      try {
        importScripts(url);
        resolve();
      } catch (error) {
        tryNext();
      }
    };
    tryNext();
  });
}

const initPromise = (async () => {
  await loadCore();
  g_module = await createFFmpegCore({
    locateFile: (path) => (path.endsWith('.wasm') ? '/ffmpeg/ffmpeg-core.wasm' : path),
  });
})();

function clearDir(path) {
  let entries = [];
  try {
    entries = g_module.FS.readdir(path);
  } catch (error) {
    return; // directory might not exist yet
  }
  for (const entry of entries) {
    if (entry === '.' || entry === '..') continue;
    try {
      g_module.FS.unlink(`${path}/${entry}`);
    } catch (error) {
      // best effort
    }
  }
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    await initPromise;
    switch (type) {
      case 'ping': {
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'mkdir': {
        try { g_module.FS.mkdir(payload.path); } catch (error) { /* already exists */ }
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'cleardir': {
        clearDir(payload.path);
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'unlink': {
        try { g_module.FS.unlink(payload.path); } catch (error) { /* ignore */ }
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'writeFile': {
        g_module.FS.writeFile(payload.path, payload.data);
        self.postMessage({ id, ok: true, result: null });
        break;
      }
      case 'readFile': {
        const data = g_module.FS.readFile(payload.path);
        self.postMessage({ id, ok: true, result: data }, [data.buffer]);
        break;
      }
      case 'exec': {
        const ret = g_module.exec(...payload.args);
        self.postMessage({ id, ok: true, result: ret });
        break;
      }
      default:
        throw new Error(`unknown ffmpeg-worker message: ${type}`);
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
