// JWT Service for authentication
import { createHmac, timingSafeEqual } from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';

const JWT_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

export interface JwtPayload {
  userId: string;
  walletAddr: string;
  iat?: number;
  exp?: number;
}

function toBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function sign(data: string) {
  return createHmac('sha256', JWT_SECRET).update(data).digest();
}

export async function signToken(payload: JwtPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRES_IN_SECONDS,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(body));
  const signature = toBase64Url(sign(`${encodedHeader}.${encodedPayload}`));

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null;
    }

    const header = JSON.parse(fromBase64Url(encodedHeader).toString('utf8')) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);
    const receivedSignature = fromBase64Url(encodedSignature);
    if (
      expectedSignature.length !== receivedSignature.length ||
      !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    if (!payload.userId || !payload.walletAddr) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export const jwtService = {
  signToken,
  verifyToken,
};
