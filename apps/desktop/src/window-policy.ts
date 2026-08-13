/**
 * URL policy for the Electron renderer boundary.
 *
 * The renderer is served by the harness loopback server, but its document and
 * plugin output are still untrusted inputs at this boundary. Keep navigation
 * inside the booted origin and allow only browser-safe external protocols.
 * @module @deepseek-ai/dsh-desktop/window-policy
 */

/** Protocols that may be handed to the operating system's default browser or mail client. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Whether a URL is safe to pass to Electron's `shell.openExternal`.
 * @param value - the candidate URL.
 * @returns true for HTTP(S) URLs with a host and mailto URLs with a recipient.
 */
export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false
    if (url.protocol === 'mailto:') return url.pathname.length > 0
    return url.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * Whether a renderer navigation stays on the booted harness origin.
 * @param value - the candidate navigation URL.
 * @param origin - the expected origin, such as `http://127.0.0.1:43123`.
 * @returns true only when both values parse and have the same origin.
 */
export function isSameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}
