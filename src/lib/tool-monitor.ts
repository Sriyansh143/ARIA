/**
 * tool-monitor.ts — Monitors installed software/tools on the host system.
 *
 * Scans PATH + common install locations for known tools.
 * Maintains an inventory in memory (MemoryItem table).
 * Checks for changes periodically (new tools added, tools removed).
 *
 * Ported concept from jarvis zip's installed-software.ts.
 */

import { db } from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DetectedTool {
  id: string;
  name: string;
  category: 'coding' | 'media' | 'office' | 'system' | 'browser' | 'ai' | 'communication';
  found: boolean;
  path?: string;
  version?: string;
}

// Known tools to scan for
const KNOWN_TOOLS: Array<Omit<DetectedTool, 'found' | 'path' | 'version'>> = [
  // Coding
  { id: 'node', name: 'Node.js', category: 'coding' },
  { id: 'bun', name: 'Bun', category: 'coding' },
  { id: 'npm', name: 'npm', category: 'coding' },
  { id: 'git', name: 'Git', category: 'coding' },
  { id: 'python3', name: 'Python 3', category: 'coding' },
  { id: 'pip3', name: 'pip', category: 'coding' },
  { id: 'code', name: 'VS Code CLI', category: 'coding' },
  { id: 'docker', name: 'Docker', category: 'coding' },
  { id: 'rg', name: 'ripgrep', category: 'coding' },
  // Media
  { id: 'ffmpeg', name: 'FFmpeg', category: 'media' },
  { id: 'convert', name: 'ImageMagick', category: 'media' },
  { id: 'blender', name: 'Blender', category: 'media' },
  // Office
  { id: 'soffice', name: 'LibreOffice', category: 'office' },
  // System
  { id: 'curl', name: 'curl', category: 'system' },
  { id: 'wget', name: 'wget', category: 'system' },
  { id: 'ssh', name: 'SSH', category: 'system' },
  { id: 'sqlite3', name: 'SQLite', category: 'system' },
  // Browser
  { id: 'chromium', name: 'Chromium', category: 'browser' },
  { id: 'google-chrome', name: 'Google Chrome', category: 'browser' },
  // AI
  { id: 'ollama', name: 'Ollama', category: 'ai' },
  // Communication
  { id: 'telegram-desktop', name: 'Telegram Desktop', category: 'communication' },
];

/**
 * Scan the system for installed tools.
 * Returns a list of detected tools with their paths + versions.
 */
export async function scanInstalledTools(): Promise<DetectedTool[]> {
  const results: DetectedTool[] = [];

  for (const tool of KNOWN_TOOLS) {
    try {
      // Check if the command exists
      const { stdout } = await execAsync(`which ${tool.id} 2>/dev/null || echo "NOT_FOUND"`, { timeout: 5000 });
      const path = stdout.trim();
      const found = path !== 'NOT_FOUND' && path.length > 0;

      let version: string | undefined;
      if (found) {
        try {
          const { stdout: verOut } = await execAsync(`${tool.id} --version 2>/dev/null | head -1`, { timeout: 5000 });
          version = verOut.trim().slice(0, 100);
        } catch { /* version check failed, tool still found */ }
      }

      results.push({
        ...tool,
        found,
        path: found ? path : undefined,
        version,
      });
    } catch {
      results.push({ ...tool, found: false });
    }
  }

  return results;
}

/**
 * Save the tool inventory to memory.
 * Creates/updates a pinned memory item with the full inventory.
 */
export async function saveToolInventory(tools: DetectedTool[]): Promise<void> {
  const found = tools.filter(t => t.found);
  const inventory = found.map(t => ({
    id: t.id,
    name: t.name,
    category: t.category,
    version: t.version,
    path: t.path,
  }));

  const inventoryJson = JSON.stringify(inventory, null, 2);

  // Upsert the memory item
  const existing = await db.memoryItem.findFirst({
    where: { key: 'tool-inventory', scope: 'semantic' },
  });

  if (existing) {
    await db.memoryItem.update({
      where: { id: existing.id },
      data: {
        value: inventoryJson.slice(0, 10000),
        tags: JSON.stringify(['tool-inventory', 'system-scan', `${found.length}-tools`]),
        pinned: true,
      },
    });
  } else {
    await db.memoryItem.create({
      data: {
        scope: 'semantic',
        key: 'tool-inventory',
        value: inventoryJson.slice(0, 10000),
        tags: JSON.stringify(['tool-inventory', 'system-scan', `${found.length}-tools`]),
        pinned: true,
      },
    });
  }

  // Create a notification if new tools detected
  const previousInventory = existing?.value ? JSON.parse(existing.value) : [];
  const previousIds = new Set(previousInventory.map((t: DetectedTool) => t.id));
  const newTools = found.filter(t => !previousIds.has(t.id));
  const removedTools = previousInventory.filter((t: DetectedTool) => !found.find(f => f.id === t.id));

  if (newTools.length > 0 || removedTools.length > 0) {
    await db.notification.create({
      data: {
        type: 'info',
        title: 'Tool Inventory Updated',
        message: `${found.length} tools found. ${newTools.length} new: ${newTools.map(t => t.name).join(', ') || 'none'}. ${removedTools.length} removed: ${removedTools.map((t: DetectedTool) => t.name).join(', ') || 'none'}.`,
      },
    }).catch(() => {});
  }
}

/**
 * Full tool scan + save. Called by the cron job.
 */
export async function runToolScan(): Promise<{ found: number; newTools: number; removedTools: number }> {
  const tools = await scanInstalledTools();
  const found = tools.filter(t => t.found);

  // Check for changes before saving
  const existing = await db.memoryItem.findFirst({
    where: { key: 'tool-inventory', scope: 'semantic' },
  });
  const previousInventory = existing?.value ? JSON.parse(existing.value) : [];
  const previousIds = new Set(previousInventory.map((t: DetectedTool) => t.id));
  const newTools = found.filter(t => !previousIds.has(t.id)).length;
  const removedTools = previousInventory.filter((t: DetectedTool) => !found.find(f => f.id === t.id)).length;

  await saveToolInventory(tools);

  return { found: found.length, newTools, removedTools };
}

/**
 * Get the current tool inventory from memory.
 */
export async function getToolInventory(): Promise<DetectedTool[]> {
  const item = await db.memoryItem.findFirst({
    where: { key: 'tool-inventory', scope: 'semantic' },
  });
  if (!item) return [];
  try {
    return JSON.parse(item.value);
  } catch {
    return [];
  }
}
