import { NextResponse } from "next/server";

import {
  getAnalyticsAdminUser,
  getAnalyticsDashboardData,
} from "@/lib/analytics/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAnalyticsAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await getAnalyticsDashboardData();
  return NextResponse.json(data);
}
