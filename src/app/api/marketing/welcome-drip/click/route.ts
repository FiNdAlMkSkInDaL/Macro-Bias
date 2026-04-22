import { NextResponse } from "next/server";

import { logMarketingEvent } from "@/lib/analytics/server";
import { getAppUrl } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSafeRedirectTarget(rawTarget: string | null) {
  if (!rawTarget) {
    return new URL("/emails", getAppUrl()).toString();
  }

  try {
    const target = new URL(rawTarget);
    const appUrl = new URL(getAppUrl());
    const sameHost =
      target.hostname === appUrl.hostname ||
      target.hostname === "www.macro-bias.com" ||
      target.hostname === "macro-bias.com";

    if (!sameHost) {
      return new URL("/emails", getAppUrl()).toString();
    }

    return target.toString();
  } catch {
    return new URL("/emails", getAppUrl()).toString();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deliveryId = url.searchParams.get("delivery")?.trim();
  const linkType = url.searchParams.get("linkType")?.trim() ?? "unknown";
  const redirectTarget = getSafeRedirectTarget(url.searchParams.get("target"));

  if (deliveryId) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data } = await supabase
        .from("welcome_email_drip_deliveries")
        .select("email, sequence_order")
        .eq("id", deliveryId)
        .maybeSingle();

      if (data) {
        await logMarketingEvent({
          eventName: "welcome_drip_click",
          metadata: {
            delivery_id: deliveryId,
            link_type: linkType,
            sequence_order: data.sequence_order,
            target: redirectTarget,
          },
          pagePath: "/api/marketing/welcome-drip/click",
          subscriberEmail: data.email,
        });
      }
    } catch (error) {
      console.error("[welcome-drip-click] failed to log click", error);
    }
  }

  return NextResponse.redirect(redirectTarget, { status: 302 });
}
