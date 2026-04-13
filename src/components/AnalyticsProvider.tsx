"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { getAnonymousId, getSessionId, trackClientEvent } from "@/lib/analytics/client";

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
    getAnonymousId();
    getSessionId();
  }, []);

  useEffect(() => {
    const queryString = searchParams.toString();
    const pagePath = queryString ? `${pathname}?${queryString}` : pathname;

    if (!pagePath || lastTrackedPathRef.current === pagePath) {
      return;
    }

    lastTrackedPathRef.current = pagePath;
    trackClientEvent({
      eventName: "page_view",
      metadata: {
        title: document.title,
      },
      pagePath,
    });
  }, [pathname, searchParams]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
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
        },
      });
    }

    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return null;
}
