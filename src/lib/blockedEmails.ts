// Blocked emails - these accounts are permanently banned
const BLOCKED_EMAILS = new Set([
  "lucaseucontato@gmail.com",
  "rodrigofaro@gmail.com",
  "test_redteam@gmail.com",
]);

// Also block by UID for accounts where email may change
const BLOCKED_UIDS = new Set<string>([
  "irmJtz4yJdhHRvRdpdkTGldOBYG2",
]);

export function isBlockedUid(uid: string): boolean {
  return BLOCKED_UIDS.has(uid);
}

export function isBlockedEmail(email: string): boolean {
  return BLOCKED_EMAILS.has(email.toLowerCase().trim());
}
