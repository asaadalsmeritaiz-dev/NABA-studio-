const REDACTED_KEYS = new Set([
  'password',
  'password_hash',
  'passcode',
  'token',
  'access_token',
  'media_token',
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'gemini_api_key',
  'heygen_api_key',
  'did_api_key',
]);

function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMeta(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase()) || /secret|token|password|key/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeMeta(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(
  level: LogLevel,
  event: string,
  meta?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === 'test' && level === 'info') {
    return;
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'naba-ai-video-studio',
    event,
    ...(meta ? { meta: sanitizeMeta(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
