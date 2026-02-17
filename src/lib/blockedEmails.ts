// Blocked emails - these accounts are permanently banned
const BLOCKED_EMAILS = new Set([
  "rodrigofaro@gmail.com",
  "test_redteam@gmail.com",
  "silvacarolinem7@gmail.com",
  "lucky_pentester@example.com",
]);

// Also block by UID for accounts where email may change
const BLOCKED_UIDS = new Set<string>([
  "irmJtz4yJdhHRvRdpdkTGldOBYG2",
]);

// Patterns that indicate automated/spam accounts (checked on email local part)
const SPAM_EMAIL_PATTERNS = [
  /^spam_/i,
  /^attack_/i,
  /^bot_/i,
  /^hack_/i,
  /^fake_/i,
  /^flood_/i,
  /^quota_/i,
  /^spam_quota/i,
  /^test_.*\d{3,}/i,       // test_anything_12345
  /^[a-z]{1,3}_\d{6,}/i,   // a_123456 (short prefix + many digits)
  /^.{50,}$/,               // local part > 50 chars
];

export function isBlockedUid(uid: string): boolean {
  return BLOCKED_UIDS.has(uid);
}

export function isBlockedEmail(email: string): boolean {
  return BLOCKED_EMAILS.has(email.toLowerCase().trim());
}

/** Detect spam/bot email patterns used in automated attacks */
export function isSpamEmailPattern(email: string): boolean {
  const local = (email.split('@')[0] || '').toLowerCase();
  return SPAM_EMAIL_PATTERNS.some(p => p.test(local));
}
