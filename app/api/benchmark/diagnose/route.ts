// app/api/benchmark/diagnose/route.ts — VPS edition
// Proxy trực tiếp sang VPS /api/benchmark/diagnose
// Không còn check CF Worker deploy status nữa

import { NextRequest } from "next/server";
import { proxyToBenchmarkWorker } from "@/app/api/_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  return proxyToBenchmarkWorker(req, "/diagnose", "GET");
}