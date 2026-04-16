"use client";

import { useEffect, useState } from "react";

import { trackClientEvent } from "@/lib/analytics/client";

import {
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_STORAGE_KEY,
} from "@/lib/referral/constants";

export function normalizeReferralCode(value: string | null) {
  return value?.trim().toLowerCase().slice(0, REFERRAL_CODE_MAX_LENGTH) || null;
}

export function useReferralCode() {
  const [refCode, setRefCode] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryRef = normalizeReferralCode(searchParams.get("ref"));

    if (queryRef) {
      setRefCode(queryRef);
      sessionStorage.setItem(REFERRAL_STORAGE_KEY, queryRef);
      trackClientEvent({
        eventName: "referral_link_clicked",
        pagePath: window.location.pathname,
        metadata: {
          referral_code: queryRef,
        },
      });
      return;
    }

    const storedRef = normalizeReferralCode(sessionStorage.getItem(REFERRAL_STORAGE_KEY));

    if (storedRef) {
      setRefCode(storedRef);
    }
  }, []);

  return refCode;
}