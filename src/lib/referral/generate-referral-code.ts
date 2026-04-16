import crypto from 'crypto';

const CODE_LENGTH = 8;
const CODE_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return code;
}
