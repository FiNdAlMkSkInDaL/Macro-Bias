/**
 * Resend rejects reserved domains (example.com, test.com, and the RFC 2606
 * set) with a 422 on the whole batch. An unverified from-domain is a separate
 * test restriction: the API will only deliver to the account owner.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLOCKED_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'example.edu',
  'test.com',
]);

export type RejectedRecipient = {
  email: string;
  reason: string;
};

export type RecipientPartition = {
  deliverable: string[];
  rejected: RejectedRecipient[];
};

export class ResendBatchError extends Error {
  readonly rejectedAddresses: string[];
  readonly testRestricted: boolean;

  constructor(
    message: string,
    options: { rejectedAddresses: string[]; testRestricted: boolean },
  ) {
    super(message);
    this.name = 'ResendBatchError';
    this.rejectedAddresses = options.rejectedAddresses;
    this.testRestricted = options.testRestricted;
  }
}

export function normalizeRecipient(email: string) {
  return email.trim().toLowerCase();
}

export function sendingDomain(fromAddress: string) {
  const match = fromAddress.match(/@([a-z0-9.-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/** True when the from-address is Resend's shared test domain. */
export function isUnverifiedTestSender(fromAddress: string) {
  const domain = sendingDomain(fromAddress);
  return domain === 'resend.dev';
}

/**
 * The 403 Resend returns when the API key can only mail the account owner.
 * The 422 for example.com is a different error and must not be treated as this.
 */
export function isResendTestRestrictionMessage(message: string) {
  return (
    /only send testing emails to your own email address/i.test(message) ||
    /verify a domain at resend\.com\/domains/i.test(message) ||
    /domain is not verified/i.test(message)
  );
}

export function rejectionReason(email: string): string | null {
  const trimmed = email.trim();

  if (!trimmed || trimmed.length > 320 || !EMAIL_PATTERN.test(trimmed)) {
    return `Invalid email address: ${trimmed || '(empty)'}`;
  }

  const domain = trimmed.split('@')[1]?.toLowerCase() ?? '';
  const blocked =
    BLOCKED_DOMAINS.has(domain) ||
    domain.endsWith('.example.com') ||
    domain.endsWith('.example.net') ||
    domain.endsWith('.example.org') ||
    domain.endsWith('.example.edu') ||
    domain.endsWith('.test.com') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.example');

  if (blocked) {
    return `Resend rejects ${trimmed}`;
  }

  return null;
}

/** Customer-facing copy. Never names the email vendor. */
export function customerEmailRejection(email: string): string | null {
  const trimmed = email.trim();

  if (!trimmed) {
    return 'Email is required.';
  }

  const reason = rejectionReason(trimmed);

  if (!reason) {
    return null;
  }

  if (reason.startsWith('Invalid email')) {
    return 'Enter a valid email address.';
  }

  return 'Use an email address that can receive mail.';
}

export function partitionRecipients(emails: readonly string[]): RecipientPartition {
  const deliverable: string[] = [];
  const rejected: RejectedRecipient[] = [];
  const seen = new Set<string>();

  for (const raw of emails) {
    const email = raw.trim();
    const key = normalizeRecipient(email);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const reason = rejectionReason(email);

    if (reason) {
      rejected.push({ email, reason });
    } else {
      deliverable.push(email);
    }
  }

  return { deliverable, rejected };
}

export function formatAddressList(emails: readonly string[]) {
  return emails.length > 0 ? emails.join(', ') : '(none)';
}
