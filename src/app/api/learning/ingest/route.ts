import { NextRequest, NextResponse } from "next/server";
import { ingestWebUrl, ingestVideoLink, ingestSocialFeed, runDailyLearning } from "@/lib/hermes/learning";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {

  const body = await req.json();
  
  if (body.runDaily) {
    const result = await runDailyLearning();
    return NextResponse.json(result);
  }
  
  if (body.url) {
    const isVideo = body.url.includes("youtube.com") || body.url.includes("vimeo.com");
    const result = isVideo ? await ingestVideoLink(body.url) : await ingestWebUrl(body.url);
    return NextResponse.json(result);
  }
  
  if (body.platform && body.topic) {
    const result = await ingestSocialFeed(body.platform, body.topic);
    return NextResponse.json(result);
  }
  
  return NextResponse.json({ error: "Provide url, or platform+topic, or runDaily=true" }, { status: 400 });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
