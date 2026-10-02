import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/PasswordRecoveryForms';

export const metadata: Metadata = {
  title: 'Reset your password',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
