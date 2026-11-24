import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from '../db.ts';
import { generateOpaqueToken, hashSecretToken } from './security.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'instructor' | 'admin' | 'reviewer';
  locale: 'ar' | 'en';
  workspace_claimed: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
}

const SESSION_TTL_HOURS = 24 * 7;
const MEDIA_TOKEN_TTL_HOURS = 12;

export const DEFAULT_INSTRUCTOR_ID = 'usr-naba-instructor';
export const DEFAULT_INSTRUCTOR_EMAIL = 'instructor@naba.academy';

export function getConfiguredAdminPasscode(): string | null {
  const raw = process.env.STUDIO_ADMIN_PASSCODE?.trim();
  return raw && raw.length >= 4 ? raw : null;
}

export function isWorkspaceClaimRequired(db: DatabaseSync): boolean {
  if (getConfiguredAdminPasscode()) return false;
  const row = db
    .prepare('SELECT workspace_claimed FROM users WHERE id = ?')
    .get(DEFAULT_INSTRUCTOR_ID) as { workspace_claimed?: number } | undefined;
  if (!row) return false;
  return Number(row.workspace_claimed ?? 0) === 0;
}

export function issueSessionForUser(
  db: DatabaseSync,
  userId: string,
): { token: string; mediaToken: string; expiresAt: string } {
  const rawToken = generateOpaqueToken(32);
  const rawMediaToken = generateOpaqueToken(24);
  const sessionExpires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  const mediaExpires = new Date(Date.now() + MEDIA_TOKEN_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
  ).run(hashSecretToken(rawToken), userId, sessionExpires);

  db.prepare(
    `INSERT INTO media_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
  ).run(hashSecretToken(rawMediaToken), userId, mediaExpires);

  // Prune expired sessions lazily
  db.prepare(`DELETE FROM user_sessions WHERE expires_at < ?`).run(new Date().toISOString());
  db.prepare(`DELETE FROM media_tokens WHERE expires_at < ?`).run(new Date().toISOString());

  return { token: rawToken, mediaToken: rawMediaToken, expiresAt: sessionExpires };
}

export function revokeSessionToken(db: DatabaseSync, rawToken: string): void {
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashSecretToken(rawToken));
}

export function hydrateUserRow(row: Record<string, unknown>): AuthenticatedUser {
  const roleStr = String(row.role || 'instructor');
  const role: AuthenticatedUser['role'] =
    roleStr === 'admin' || roleStr === 'reviewer' ? roleStr : 'instructor';
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role,
    locale: row.locale === 'en' ? 'en' : 'ar',
    workspace_claimed: Boolean(row.workspace_claimed),
  };
}

export function lookupUserBySessionToken(db: DatabaseSync, rawToken: string): AuthenticatedUser | null {
  if (!rawToken || rawToken.length < 16) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.locale, u.workspace_claimed, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashSecretToken(rawToken)) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashSecretToken(rawToken));
    return null;
  }
  return hydrateUserRow(row);
}

export function lookupUserByMediaToken(db: DatabaseSync, rawToken: string): AuthenticatedUser | null {
  if (!rawToken || rawToken.length < 16) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.locale, u.workspace_claimed, m.expires_at
       FROM media_tokens m
       JOIN users u ON u.id = m.user_id
       WHERE m.token_hash = ?`,
    )
    .get(hashSecretToken(rawToken)) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    db.prepare('DELETE FROM media_tokens WHERE token_hash = ?').run(hashSecretToken(rawToken));
    return null;
  }
  return hydrateUserRow(row);
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9\-_]+)$/i);
  return match ? match[1] : null;
}

export function createRequireAuth(db: DatabaseSync) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required. Please sign in to Naba AI Video Studio.' });
      return;
    }
    const user = lookupUserBySessionToken(db, token);
    if (!user) {
      res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      return;
    }
    req.user = user;
    next();
  };
}

export function createRequireMediaAuth(db: DatabaseSync) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const bearer = extractBearerToken(req);
    if (bearer) {
      const user = lookupUserBySessionToken(db, bearer);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }

    const mediaTok = typeof req.query.media_token === 'string' ? req.query.media_token.trim() : '';
    if (mediaTok) {
      const user = lookupUserByMediaToken(db, mediaTok);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }

    res.status(401).json({ error: 'Authentication required to access media assets.' });
  };
}

export function canAccessResource(ownerUserId: string | null | undefined, user: AuthenticatedUser): boolean {
  if (user.role === 'admin') return true;
  if (!ownerUserId) return user.id === DEFAULT_INSTRUCTOR_ID;
  return ownerUserId === user.id;
}

export function authenticateUserCredentials(
  db: DatabaseSync,
  email: string,
  password: string,
): AuthenticatedUser | null {
  const normalizedEmail = email.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(email) = ?')
    .get(normalizedEmail) as Record<string, unknown> | undefined;
  if (!row) return null;

  // Configured env passcode always overrides claimed fallback hash for default instructor
  const envPasscode = getConfiguredAdminPasscode();
  if (envPasscode && String(row.id) === DEFAULT_INSTRUCTOR_ID) {
    const expected = Buffer.from(envPasscode, 'utf8');
    const actual = Buffer.from(password, 'utf8');
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      return hydrateUserRow(row);
    }
    return null;
  }

  // If default instructor hasn't claimed workspace yet and no env passcode is configured, disallow password login until claimed
  if (String(row.id) === DEFAULT_INSTRUCTOR_ID && Number(row.workspace_claimed ?? 0) === 0) {
    return null;
  }

  if (!verifyPassword(password, String(row.password_hash))) {
    return null;
  }
  return hydrateUserRow(row);
}

export function claimDefaultWorkspace(
  db: DatabaseSync,
  password: string,
  displayName?: string,
): { ok: true; user: AuthenticatedUser } | { ok: false; status: number; error: string } {
  if (getConfiguredAdminPasscode()) {
    return {
      ok: false,
      status: 403,
      error: 'Workspace passcode is managed via STUDIO_ADMIN_PASSCODE environment configuration.',
    };
  }

  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(DEFAULT_INSTRUCTOR_ID) as Record<string, unknown> | undefined;
  if (!row) {
    return { ok: false, status: 404, error: 'Default instructor profile not found.' };
  }

  if (Number(row.workspace_claimed ?? 0) === 1) {
    return {
      ok: false,
      status: 409,
      error: 'Workspace has already been claimed. Please sign in with your instructor password.',
    };
  }

  const newHash = hashPassword(password);
  const nextName = displayName && displayName.trim().length >= 2 ? displayName.trim().slice(0, 80) : String(row.name);

  // Atomic one-time claim update
  const info = db
    .prepare(
      `UPDATE users SET password_hash = ?, name = ?, workspace_claimed = 1
       WHERE id = ? AND workspace_claimed = 0`,
    )
    .run(newHash, nextName, DEFAULT_INSTRUCTOR_ID);

  if (Number(info.changes) === 0) {
    return { ok: false, status: 409, error: 'Workspace has already been claimed.' };
  }

  const updated = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(DEFAULT_INSTRUCTOR_ID) as Record<string, unknown>;
  return { ok: true, user: hydrateUserRow(updated) };
}

export function registerInstructorUser(
  db: DatabaseSync,
  params: { email: string; name: string; password: string; locale: 'ar' | 'en' },
): { ok: true; user: AuthenticatedUser } | { ok: false; status: number; error: string } {
  const email = params.email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) {
    return { ok: false, status: 409, error: 'An account with this email already exists.' };
  }

  const userId = `usr-${crypto.randomUUID().slice(0, 10)}`;
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, locale, workspace_claimed)
     VALUES (?, ?, ?, 'instructor', ?, ?, 1)`,
  ).run(userId, email, params.name.trim(), hashPassword(params.password), params.locale);

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  return { ok: true, user: hydrateUserRow(created) };
}
