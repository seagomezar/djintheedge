/**
 * OPFS-backed model loader for the on-device LLM.
 *
 * Responsibilities:
 *  - Check the Origin Private File System (OPFS) for a cached model binary.
 *  - On a cache miss, stream the model from a same-origin URL with progress,
 *    then persist it to OPFS so later runs restore instantly and offline.
 *  - Return an object URL the MediaPipe runtime can load from.
 *
 * All failures are surfaced as thrown Errors so the caller (LiteRTLMEngine /
 * AIManager) can fall back to the rule-based parser. This module performs no
 * inference and has no dependency on the model runtime; it is pure storage +
 * networking, which keeps it unit-testable with mocked `fetch` and OPFS.
 */

/** Feature-detect OPFS. */
export function isOpfsSupported() {
    return typeof navigator !== "undefined" &&
        navigator.storage &&
        typeof navigator.storage.getDirectory === "function";
}

/**
 * Reads a cached model file from OPFS, if present.
 * @param {string} fileName cache key (model file name)
 * @returns {Promise<Blob|null>} the cached blob, or null on a miss
 */
async function readFromOpfs(fileName) {
    if (!isOpfsSupported()) return null;
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(fileName, { create: false });
        const file = await handle.getFile();
        if (file && file.size > 0) return file;
        return null;
    } catch (err) {
        // NotFoundError (cache miss) is expected; anything else is a soft miss.
        return null;
    }
}

/**
 * Writes a model blob to OPFS. Best-effort: a write failure (e.g. quota) does
 * not abort the load, it just means the next run re-downloads.
 * @param {string} fileName cache key
 * @param {Blob} blob model bytes
 * @returns {Promise<boolean>} true if persisted
 */
async function writeToOpfs(fileName, blob) {
    if (!isOpfsSupported()) return false;
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    } catch (err) {
        console.warn("model-loader: failed to persist model to OPFS (will re-download next run):", err);
        // A half-written file would pass the size>0 cache check on the next run
        // and load a corrupt model. Remove the partial entry best-effort.
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(fileName);
        } catch { /* nothing to clean up */ }
        return false;
    }
}

/**
 * Streams a URL to a Blob, reporting fractional progress via `onProgress`.
 * Uses the Content-Length header when available; otherwise reports coarse
 * progress and completes at 1.0.
 * @param {string} url same-origin model URL
 * @param {(fraction:number)=>void} onProgress
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
async function streamToBlob(url, onProgress, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`model-loader: download failed with HTTP ${response.status}`);
    }

    const totalBytes = Number(response.headers.get("Content-Length")) || 0;

    // No streaming body available: fall back to a single blob read.
    if (!response.body || typeof response.body.getReader !== "function") {
        const blob = await response.blob();
        if (onProgress) onProgress(1);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    // Guard against non-monotonic / >1 progress if headers lie.
    let lastReported = 0;
    for (;;) {
        // Stop promptly on abort: cancel the reader so the TCP connection is
        // closed and we stop buffering chunks in memory.
        if (signal && signal.aborted) {
            await reader.cancel();
            const err = new Error("model download aborted");
            err.name = "AbortError";
            throw err;
        }
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress && totalBytes > 0) {
            const frac = Math.min(0.999, received / totalBytes);
            if (frac > lastReported) {
                lastReported = frac;
                onProgress(frac);
            }
        }
    }

    if (onProgress) onProgress(1);
    return new Blob(chunks);
}

/**
 * Loads the model, preferring the OPFS cache. On a miss, downloads + caches.
 *
 * @param {object} options
 * @param {string} options.modelUrl same-origin URL of the model binary
 * @param {string} [options.fileName] OPFS cache key (defaults to the URL's basename)
 * @param {(fraction:number)=>void} [options.onProgress] 0..1 progress callback
 * @param {AbortSignal} [options.signal] abort the download
 * @returns {Promise<{ objectUrl: string, fromCache: boolean, revoke: ()=>void }>}
 */
export async function loadModel({ modelUrl, fileName, onProgress, signal } = {}) {
    if (!modelUrl) throw new Error("model-loader: modelUrl is required");
    const key = fileName || modelUrl.split("/").pop() || "model.bin";

    // 1. Cache hit?
    const cached = await readFromOpfs(key);
    if (cached) {
        if (onProgress) onProgress(1);
        const objectUrl = URL.createObjectURL(cached);
        return { objectUrl, fromCache: true, revoke: () => URL.revokeObjectURL(objectUrl) };
    }

    // 2. Cache miss: stream from network with progress.
    const blob = await streamToBlob(modelUrl, onProgress, signal);

    // 3. Persist for next time (best-effort).
    await writeToOpfs(key, blob);

    const objectUrl = URL.createObjectURL(blob);
    return { objectUrl, fromCache: false, revoke: () => URL.revokeObjectURL(objectUrl) };
}
