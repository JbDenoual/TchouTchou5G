import { PING_TARGET_URL } from './config.js';

// Effectue un ping réseau (fetch chronométré) et attend jusqu'au timeout
// avant de considérer l'échec — pas d'abandon anticipé.
// Retourne { elapsedMs, success }.
export async function pingOnce(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();

  try {
    await fetch(PING_TARGET_URL, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return { elapsedMs: Math.round(performance.now() - t0), success: true };
  } catch {
    return { elapsedMs: Math.round(performance.now() - t0), success: false };
  } finally {
    clearTimeout(timer);
  }
}
