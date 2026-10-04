'use client';

import { usePathname } from 'next/navigation';
import { RouteLoading } from './RouteLoading';

/** The shared crypto layout can suspend before its child's loading boundary. */
export function CryptoRouteLoading() {
  const pathname = usePathname();
  if (pathname === '/crypto/dashboard') {
    return <RouteLoading label="Loading crypto workspace" layout="dashboard" market="crypto" />;
  }
  if (pathname === '/crypto/track-record') {
    return <RouteLoading label="Loading crypto history" layout="archive" market="crypto" />;
  }
  if (pathname === '/crypto/briefings') {
    return <RouteLoading label="Loading crypto briefings" layout="archive" market="crypto" />;
  }
  if (pathname?.startsWith('/crypto/briefings/')) {
    return <RouteLoading label="Loading crypto briefing" layout="article" market="crypto" />;
  }
  return <RouteLoading label="Loading crypto reading" layout="reading" market="crypto" />;
}
