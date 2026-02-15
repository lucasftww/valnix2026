// Blocked emails - these accounts are permanently banned
const BLOCKED_EMAILS = new Set([
  "lucaseucontato@gmail.com",
  "rodrigofaro@gmail.com",
]);

export function isBlockedEmail(email: string): boolean {
  return BLOCKED_EMAILS.has(email.toLowerCase().trim());
}
