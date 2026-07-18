// SQLite Write Queue — serializes all Prisma write operations through an
// in-memory queue. Eliminates SQLITE_BUSY errors. No-op pass-through for PG.
import { db } from '@/lib/db'
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'fs'
import { join } from 'path'

// Phase 45 fix: use process.cwd() instead of import.meta.url for Windows
// ESM/CJS interop safety with Turbopack/Webpack.
const QUEUE_DIR = join(process.cwd(), 'db')
const PENDING_FILE = join(QUEUE_DIR, 'write-queue.pending.json')
const WAL_FILE = join(QUEUE_DIR, 'write-queue.wal.log')
try { mkdirSync(QUEUE_DIR, { recursive: true }) } catch {}

function detectPostgres(): boolean {
  const url = process.env.DATABASE_URL || ''
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}
const isPostgres = detectPostgres()

interface WriteOp { id: string; model: string; operation: 'create' | 'update' | 'delete' | 'upsert'; where?: Record<string, unknown>; data: Record<string, unknown>; timestamp: number }
const queue: WriteOp[] = []
let flushing = false; let lastFlush = 0
const FLUSH_INTERVAL_MS = 100; const MAX_BATCH_SIZE = 50

function persistQueue(): void { if (isPostgres) return; try { writeFileSync(PENDING_FILE, JSON.stringify(queue)) } catch {} }
function loadPendingQueue(): void { if (isPostgres) return; try { if (existsSync(PENDING_FILE)) { const d = readFileSync(PENDING_FILE, 'utf8'); const p = JSON.parse(d); if (Array.isArray(p) && p.length > 0) { queue.push(...p); console.log(`[db-write-queue] recovered ${p.length} pending writes`) } writeFileSync(PENDING_FILE, '[]') } } catch {} }
function walAppend(op: WriteOp): void { try { appendFileSync(WAL_FILE, JSON.stringify(op) + '\n') } catch {} }

export function enqueueWrite(model: string, operation: 'create' | 'update' | 'delete' | 'upsert', data: Record<string, unknown>, where?: Record<string, unknown>): string {
  const op: WriteOp = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, model, operation, where, data, timestamp: Date.now() }
  if (isPostgres) { executeOp(op).catch((err) => console.error(`[db-write-queue] PG write failed:`, err)); return op.id }
  queue.push(op); walAppend(op); persistQueue(); scheduleFlush(); return op.id
}

async function executeOp(op: WriteOp): Promise<void> {
  const m = (db as any)[op.model]; if (!m) throw new Error(`Unknown model: ${op.model}`)
  switch (op.operation) {
    case 'create': await m.create({ data: op.data }); break
    case 'update': await m.update({ where: op.where, data: op.data }); break
    case 'delete': await m.delete({ where: op.where }); break
    case 'upsert': await m.upsert({ where: op.where, create: op.data, update: op.data }); break
  }
}

let flushTimer: NodeJS.Timeout | null = null
function scheduleFlush(): void { if (isPostgres || flushTimer) return; const e = Date.now() - lastFlush; const d = Math.max(0, FLUSH_INTERVAL_MS - e); flushTimer = setTimeout(() => { flushTimer = null; flush().catch((err) => console.error('[db-write-queue] flush:', err)) }, d) }

async function flush(): Promise<void> {
  if (flushing || isPostgres || queue.length === 0) return
  flushing = true; lastFlush = Date.now()
  const batch = queue.splice(0, MAX_BATCH_SIZE); persistQueue()
  for (const op of batch) { try { await executeOp(op) } catch (err) { console.error(`[db-write-queue] op failed:`, err); const r = (op as any)._retries || 0; if (r < 3) { (op as any)._retries = r + 1; queue.push(op) } } }
  flushing = false
  if (queue.length > 0) scheduleFlush()
}

export const safeWrite = {
  create: (model: string, data: Record<string, unknown>) => enqueueWrite(model, 'create', data),
  update: (model: string, where: Record<string, unknown>, data: Record<string, unknown>) => enqueueWrite(model, 'update', data, where),
  delete: (model: string, where: Record<string, unknown>) => enqueueWrite(model, 'delete', {}, where),
  upsert: (model: string, where: Record<string, unknown>, data: Record<string, unknown>) => enqueueWrite(model, 'upsert', data, where),
}

export function getQueueStats() {
  return { provider: isPostgres ? 'postgres' : 'sqlite', queueEnabled: !isPostgres, pending: queue.length, flushing, lastFlushAgoMs: Date.now() - lastFlush, walSize: existsSync(WAL_FILE) ? statSync(WAL_FILE).size : 0 }
}

if (!isPostgres) { loadPendingQueue(); scheduleFlush(); process.on('beforeExit', () => { if (queue.length > 0) persistQueue() }) }
