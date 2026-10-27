import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Return-path parameters change the sign-in destination, not the page content.
// Keep crawling allowed so Google can see noindex on every existing variant.
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
  alternates: { canonical: '/login' },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
