import { VercelResponse } from '@vercel/node';
import { createHash, createHmac } from 'crypto';

/**
 * SHA-256 Hashing for Meta PII compliance
 */
export function hashData(data: string | undefined): string | null {
  if (!data) return null;
  const cleanData = data.trim().toLowerCase();
  return createHash('sha256').update(cleanData).digest('hex');
}

/**
 * HMAC verification for Admin security
 */
export function verifyAdminToken(token: string | null): boolean {
  if (!token) return false;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('CRITICAL: ADMIN_PASSWORD not set in environment');
    return false;
  }
  
  const expectedToken = createHmac('sha256', adminPassword)
    .update('admin-access')
    .digest('hex');
    
  return token === expectedToken;
}

/**
 * CORS handling for Vercel functions
 */
export function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-token'
  );
}
