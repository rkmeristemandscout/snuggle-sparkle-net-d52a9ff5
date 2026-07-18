import { reportLovableError } from "./lovable-error-reporting";

let installed = false;
let sessionId: string | undefined;

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    sessionId = crypto.randomUUID();
  } catch {
    sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return sessionId;
}

/**
 * Install browser-side global error listeners. Forwards uncaught errors and
 * unhandled promise rejections to console.error (visible in Server Logs when
 * captured by the preview shell) and to reportLovableError so the editor's
 * telemetry receives them. Every event is tagged with a per-session client
 * ID so client-side errors can be correlated with server-side request IDs.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function installClientErrorLogging() {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  const clientSessionId = getSessionId();

  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message || "Unknown error");
    console.error(`[client ${clientSessionId}] onerror`, error);
    reportLovableError(error, {
      source: "window.onerror",
      clientSessionId,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    console.error(`[client ${clientSessionId}] unhandledrejection`, reason);
    reportLovableError(reason, { source: "window.unhandledrejection", clientSessionId });
  });
}
