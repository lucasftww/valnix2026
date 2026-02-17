// Simple client-side rate limiter for auth attempts
const attempts = new Map<string, { count: number; blockedUntil: number; firstAttempt: number }>();

const MAX_LOGIN_ATTEMPTS = 5;
const MAX_SIGNUP_ATTEMPTS = 3;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SIGNUP_BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes for signup

// Global signup cooldown (prevents rapid-fire account creation)
let lastSignupAttempt = 0;
const SIGNUP_COOLDOWN_MS = 10_000; // 10 seconds between signup attempts

export function checkRateLimit(key: string, type: 'login' | 'signup' = 'login'): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();

  // Global signup cooldown
  if (type === 'signup' && lastSignupAttempt > 0 && now - lastSignupAttempt < SIGNUP_COOLDOWN_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((SIGNUP_COOLDOWN_MS - (now - lastSignupAttempt)) / 1000) };
  }

  const entry = attempts.get(key);

  if (entry && entry.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  const maxAttempts = type === 'signup' ? MAX_SIGNUP_ATTEMPTS : MAX_LOGIN_ATTEMPTS;

  // Reset if block expired
  if (entry && entry.blockedUntil <= now && entry.count >= maxAttempts) {
    attempts.delete(key);
  }

  return { allowed: true };
}

export function recordFailedAttempt(key: string, type: 'login' | 'signup' = 'login'): void {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, blockedUntil: 0, firstAttempt: now };

  entry.count += 1;

  const maxAttempts = type === 'signup' ? MAX_SIGNUP_ATTEMPTS : MAX_LOGIN_ATTEMPTS;
  const blockDuration = type === 'signup' ? SIGNUP_BLOCK_DURATION_MS : BLOCK_DURATION_MS;

  if (entry.count >= maxAttempts) {
    entry.blockedUntil = now + blockDuration;
  }

  attempts.set(key, entry);

  // Auto-cleanup old entries
  if (attempts.size > 100) {
    for (const [k, v] of attempts) {
      if (v.blockedUntil < now && v.count < maxAttempts) attempts.delete(k);
    }
  }
}

export function recordSignupAttempt(): void {
  lastSignupAttempt = Date.now();
}

export function resetAttempts(key: string): void {
  attempts.delete(key);
}

// Detect suspicious email patterns used in spam attacks
const SPAM_PATTERNS = [
  /^spam_/i,
  /^attack_/i,
  /^test_.*_\d{3,}/i, // test_anything_12345...
  /^bot_/i,
  /^hack_/i,
  /^fake_/i,
  /^flood_/i,
  /^quota_/i,
  /^.{50,}@/, // email local part > 50 chars
];

export function isSpamEmail(email: string): boolean {
  const local = email.split('@')[0] || '';
  return SPAM_PATTERNS.some(pattern => pattern.test(local));
}

export function isWeakPassword(password: string): string | null {
  if (password.length < 8) return 'Senha deve ter no mínimo 8 caracteres';
  if (!/[a-zA-Z]/.test(password)) return 'Senha deve conter pelo menos uma letra';
  if (!/\d/.test(password)) return 'Senha deve conter pelo menos um número';
  if (/^(.)\1+$/.test(password)) return 'Senha não pode ser um caractere repetido';
  const common = ['12345678', 'password', 'qwerty12', 'abcdefgh', '11111111', '00000000'];
  if (common.includes(password.toLowerCase())) return 'Senha muito comum, escolha outra';
  return null;
}
