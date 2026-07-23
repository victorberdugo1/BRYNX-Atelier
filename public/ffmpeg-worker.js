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

// ffmpeg-core.js overwrites whatever locateFile() you pass it (it has its
// own internal one baked in for its normal loading flow) and, lacking a
// mainScriptUrlOrBlob, falls back to resolving "ffmpeg-core.wasm" relative
// to *this worker script's own* directory — i.e. "/ffmpeg-core.wasm" at the
// site root, not "/ffmpeg/ffmpeg-core.wasm" where the file actually lives.
// That 404s, the dev/preview server's SPA fallback serves index.html for
// it, and WebAssembly.instantiate then chokes on HTML instead of wasm
// ("expected magic word", since it got "<!do..." instead of the binary).
// Fetching the .wasm ourselves and handing it in as Module.wasmBinary
// sidesteps locateFile entirely — the core uses it directly and never
// tries to fetch anything on its own.
function fetchWasmBinary() {
  const candidates = [
    '/ffmpeg/ffmpeg-core.wasm',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
  ];
  return (async () => {
    let lastError = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} fetching ${url}`);
          continue;
        }
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 4));
        const isWasm = head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
        if (!isWasm) {
          lastError = new Error(`${url} did not return a valid .wasm file (got something else, e.g. an HTML fallback page)`);
          continue;
        }
        return buf;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ffmpeg-core.wasm could not be loaded from any candidate URL');
  })();
}

const initPromise = (async () => {
  await loadCore();
  const wasmBinary = await fetchWasmBinary();
  g_module = await createFFmpegCore({
    wasmBinary,
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