import { NextResponse } from "next/server";

import { logMarketingEvent } from "@/lib/analytics/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PIXEL_BUFFER = Buffer.from(
  "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deliveryId = url.searchParams.get("delivery")?.trim();

  if (!deliveryId) {
    return new NextResponse(PIXEL_BUFFER, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "image/gif",
      },
      status: 200,
    });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("welcome_email_drip_deliveries")
      .select("email, sequence_order")
      .eq("id", deliveryId)
      .maybeSingle();

    if (data) {
      await logMarketingEvent({
        eventName: "welcome_drip_open",
        metadata: {
          delivery_id: deliveryId,
          sequence_order: data.sequence_order,
        },
        pagePath: "/api/marketing/welcome-drip/open",
        subscriberEmail: data.email,
      });
    }
  } catch (error) {
    console.error("[welcome-drip-open] failed to log open", error);
  }

  return new NextResponse(PIXEL_BUFFER, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "image/gif",
    },
    status: 200,
  });
}
