import { NextRequest } from "next/server";
import { adaptKimiCoco } from "../adapter";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return adaptKimiCoco(request, "status");
}
