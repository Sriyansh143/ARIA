import { NextRequest, NextResponse } from "next/server";
import { createLead, listLeads } from "@/lib/crm";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateLeadSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  company: z.string().max(200).optional(),
  source: z.string().max(50).default("website"),
  value: z.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const leads = await listLeads();
    return NextResponse.json({ leads, count: leads.length });
  } catch (err) {
    logger.error("api.crm.leads.list.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to list leads" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = CreateLeadSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "validation failed", issues: result.error.issues }, { status: 400 });
    }
    const lead = await createLead(result.data);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    logger.error("api.crm.leads.create.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to create lead" }, { status: 500 });
  }
}
