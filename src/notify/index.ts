import type { Logger } from '../logging/index.js';

export interface FailureMetrics {
  phase: string;
  duration_seconds: number;
  exit_code: number;
  reason: string;
  timestamp: string;
}

export async function notifyFailure(metrics: FailureMetrics, logger: Logger): Promise<void> {
  const url = process.env.GARDENER_WEBHOOK_URL;

  if (!url) {
    logger.info('notify_skip', { context: { reason: 'GARDENER_WEBHOOK_URL not set' } });
    return;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    logger.warn('notify_skip', { context: { reason: 'GARDENER_WEBHOOK_URL is not a valid URL' } });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
      signal: controller.signal,
    });

    logger.info('notify_sent', { phase: metrics.phase });
  } catch (err) {
    logger.warn('notify_failed', {
      phase: metrics.phase,
      error: { message: (err as Error).message },
    });
  } finally {
    clearTimeout(timer);
  }
}
