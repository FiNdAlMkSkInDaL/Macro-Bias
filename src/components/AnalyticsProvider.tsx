"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { getAcquisitionAttribution, trackClientEvent } from "@/lib/analytics/client";
import { AnalyticsPreferences } from './AnalyticsPreferences';

function getElementLabel(element: HTMLElement) {
  const explicitLabel = element.dataset.analyticsLabel?.trim();

  if (explicitLabel) {
    return explicitLabel;
  }

  const ariaLabel = element.getAttribute("aria-label")?.trim();

  if (ariaLabel) {
    return ariaLabel;
  }

  const textContent = element.textContent?.replace(/\s+/g, " ").trim();

  return textContent?.slice(0, 120) ?? null;
}

export function AnalyticsProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const queryString = searchParams.toString();
    const pagePath = queryString ? `${pathname}?${queryString}` : pathname;

    if (!pagePath || lastTrackedPathRef.current === pagePath) {
      return;
    }

    lastTrackedPathRef.current = pagePath;
    trackClientEvent({
      eventName: "page_view",
      pagePath: pathname,
    });
  }, [pathname, searchParams]);

  useEffect(() => {
    let lastActivity = 0;
    function refreshActivity() {
      const now = Date.now();
      if (now - lastActivity < 60_000) return;
      lastActivity = now;
      getAcquisitionAttribution();
    }
    function handleClick(event: MouseEvent) {
      refreshActivity();
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const trackedElement = target.closest<HTMLElement>("[data-analytics-event]");

      if (!trackedElement) {
        return;
      }

      const eventName = trackedElement.dataset.analyticsEvent;

      if (!eventName) {
        return;
      }

      const href = trackedElement instanceof HTMLAnchorElement
        ? trackedElement.href
        : trackedElement.getAttribute("href");

      trackClientEvent({
        eventName,
        metadata: {
          href,
          label: getElementLabel(trackedElement),
          location: trackedElement.dataset.analyticsLocation ?? null,
          method: trackedElement.dataset.analyticsMethod ?? null,
        },
      });
    }

    document.addEventListener("click", handleClick);
    document.addEventListener('keydown', refreshActivity, { passive: true });
    document.addEventListener('scroll', refreshActivity, { passive: true });

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener('keydown', refreshActivity);
      document.removeEventListener('scroll', refreshActivity);
    };
  }, []);

  return <AnalyticsPreferences pagePath={pathname} />;
}
