import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

export function hashSecretToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    lower === 'localhost' ||
    lower === 'metadata.google.internal' ||
    lower === 'metadata' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipType = net.isIP(lower);
  if (ipType === 4) {
    const parts = lower.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (ipType === 6) {
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:169.254.') ||
      lower.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates outbound external provider / webhook URLs against SSRF and invalid schemes.
 * Only allows http:/https: to non-loopback, non-private, non-metadata destinations unless
 * explicitly overridden in test environments via ALLOW_LOOPBACK_WEBHOOKS_IN_TEST.
 */
export function validateExternalEndpointUrl(
  rawUrl: string,
  options?: { allowLoopbackForTest?: boolean },
): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'Configured endpoint URL is malformed.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http:// and https:// endpoints are permitted.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Endpoint URL must not embed credentials.' };
  }

  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isLoopbackOnly = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const allowLoopback = Boolean(options?.allowLoopbackForTest) && isTestEnv && isLoopbackOnly;
  if (!allowLoopback && isPrivateOrBlockedHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'Blocked outbound request to loopback, private network, or metadata address.',
    };
  }

  return { ok: true, url: parsed };
}

/**
 * Verifies ISO Base Media File Format (MP4 / MOV) signature (`ftyp` box at bytes 4..7).
 */
export function isValidMp4Buffer(buf: Buffer): boolean {
  if (!buf || buf.length < 16) return false;
  return buf.subarray(4, 8).toString('ascii') === 'ftyp';
}

export function isValidImageBuffer(buf: Buffer): string | null {
  if (!buf || buf.length < 12) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  // WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp';
  }
  return null;
}

export function isPathConfined(candidatePath: string, allowedBaseDir: string): boolean {
  const resolvedBase = path.resolve(allowedBaseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate.startsWith(resolvedBase + path.sep);
}
