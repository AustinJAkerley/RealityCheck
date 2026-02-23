/**
 * Feedback reporting utility for false positives and missed AI detections.
 *
 * Wires up the "Report false positive / missed AI" buttons in the extension popup
 * to a configurable backend endpoint. By default reports are queued in-memory
 * (console.log fallback) until a real endpoint is configured.
 *
 * Usage:
 * ```ts
 * // In extension popup / content script:
 * import { submitFeedback } from '@reality-check/core';
 *
 * submitFeedback({
 *   contentType: 'image',
 *   feedback: 'false_positive',
 *   url: window.location.href,
 *   detectorScore: 0.72,
 *   timestamp: Date.now(),
 * });
 * ```
 *
 * To configure a real backend endpoint call `configureFeedbackEndpoint` at
 * extension startup:
 * ```ts
 * configureFeedbackEndpoint('https://your-backend.example.com/feedback');
 * ```
 */
import type { FeedbackReport } from '../types.js';

/** Maximum number of reports to buffer when offline */
const MAX_QUEUE_SIZE = 50;

let _feedbackEndpoint: string | null = null;
const _pendingQueue: FeedbackReport[] = [];

/**
 * Configure the remote endpoint that receives feedback reports.
 * Pass null (or call with no arguments) to clear the endpoint and
 * revert to console-only logging.
 */
export function configureFeedbackEndpoint(endpoint: string | null = null): void {
  _feedbackEndpoint = endpoint;
  // Flush any queued reports to the new endpoint
  if (endpoint && _pendingQueue.length > 0) {
    const toFlush = _pendingQueue.splice(0, _pendingQueue.length);
    for (const report of toFlush) {
      void _sendReport(report);
    }
  }
}

/**
 * Submit a user feedback report.
 *
 * If a feedback endpoint is configured, the report is sent immediately via
 * a non-blocking fetch. On failure (or when no endpoint is configured) the
 * report is buffered in memory and logged to the console.
 *
 * The function is intentionally fire-and-forget — callers do not need to
 * await it.
 */
export function submitFeedback(report: FeedbackReport): void {
  if (_feedbackEndpoint) {
    void _sendReport(report);
  } else {
    // Log for now; will be flushed when an endpoint is configured
    console.log('[RealityCheck] Feedback queued (no endpoint configured):', report);
    if (_pendingQueue.length < MAX_QUEUE_SIZE) {
      _pendingQueue.push(report);
    }
  }
}

async function _sendReport(report: FeedbackReport): Promise<void> {
  if (!_feedbackEndpoint) return;
  try {
    const response = await fetch(_feedbackEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!response.ok) {
      console.warn(
        `[RealityCheck] Feedback submission failed: HTTP ${response.status}`
      );
      // Re-queue on transient failure
      if (_pendingQueue.length < MAX_QUEUE_SIZE) {
        _pendingQueue.push(report);
      }
    }
  } catch {
    console.warn('[RealityCheck] Feedback submission error — queued for retry');
    if (_pendingQueue.length < MAX_QUEUE_SIZE) {
      _pendingQueue.push(report);
    }
  }
}

/**
 * Returns the current number of reports waiting to be sent.
 * Useful for unit tests and extension diagnostics.
 */
export function getPendingFeedbackCount(): number {
  return _pendingQueue.length;
}

/**
 * Clear the pending feedback queue without sending.
 * Intended for use in tests and settings resets.
 */
export function clearPendingFeedback(): void {
  _pendingQueue.length = 0;
}
