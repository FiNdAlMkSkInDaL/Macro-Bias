import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/PasswordRecoveryForms';

export const metadata: Metadata = {
  title: 'Choose a new password',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
