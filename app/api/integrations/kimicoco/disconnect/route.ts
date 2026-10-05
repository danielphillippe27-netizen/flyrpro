import { NextRequest } from "next/server";
import { adaptKimiCoco } from "../adapter";
export const runtime = "nodejs";
export function POST(request: NextRequest) {
  return adaptKimiCoco(request, "disconnect");
}
