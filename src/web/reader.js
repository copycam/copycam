// The page's handle on the text reader running in reader.worker.js. Loading
// starts at once, in the background; a scan that arrives before the reader is
// ready waits for it rather than failing.
//
// createReader() -> {
//   onProgress(fn) -> unsubscribe    fn({ loaded, total, ready, failed })
//   ocr(bytes, script) -> { words, lineCount, rotation }
//   wifi(bytes) -> { ssid, password, security, hidden } | null
//   retry()                          after a failed load
// }
export function createReader(makeWorker = () => new Worker(new URL('./reader.worker.js', import.meta.url), { type: 'module' })) {
  const worker = makeWorker();
  const listeners = new Set();
  const calls = new Map();
  let state = { loaded: 0, total: 0, ready: false, failed: null };
  let readyWaiters = [];
  let next = 0;

  const publish = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') publish({ loaded: data.loaded, total: data.total });
    else if (data.type === 'ready') {
      publish({ ready: true, failed: null });
      for (const w of readyWaiters.splice(0)) w.resolve();
    } else if (data.type === 'failed') {
      publish({ failed: data.message });
      for (const w of readyWaiters.splice(0)) w.reject(new Error(data.message));
    } else {
      const call = calls.get(data.id);
      if (!call) return;
      calls.delete(data.id);
      if (data.type === 'done') call.resolve(data.result);
      else call.reject(new Error(data.message));
    }
  };

  const whenReady = () =>
    state.ready
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          readyWaiters.push({ resolve, reject });
          if (state.failed) retry();
        });

  const ask = async (type, bytes, extra = {}) => {
    await whenReady();
    const id = next++;
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject });
      // a copy each: the photo goes to the text reader and the Wi-Fi reader at once
      const own = bytes.slice();
      worker.postMessage({ type, id, bytes: own.buffer, ...extra }, [own.buffer]);
    });
  };

  function retry() {
    publish({ failed: null, loaded: 0 });
    worker.postMessage({ type: 'load' });
  }

  worker.postMessage({ type: 'load' });

  return {
    onProgress(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    ocr: (bytes, script) => ask('ocr', bytes, { script }),
    wifi: (bytes) => ask('wifi', bytes),
    retry,
  };
}
