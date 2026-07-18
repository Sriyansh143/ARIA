import { NextResponse } from 'next/server';
import { scanInstalledTools, getToolInventory, runToolScan } from '@/lib/tool-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — return cached tool inventory from memory
export async function GET() {
  const inventory = await getToolInventory();
  return NextResponse.json({ tools: inventory, count: inventory.length });
}

// POST — run a fresh scan
export async function POST() {
  const result = await runToolScan();
  const inventory = await getToolInventory();
  return NextResponse.json({ ...result, tools: inventory });
}
