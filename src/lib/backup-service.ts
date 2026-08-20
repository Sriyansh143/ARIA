import "server-only";
import fs from "fs"; import path from "path"; import { execSync } from "child_process";
import { db } from "./db"; import { logger } from "./logger"; import { emit } from "./event-bus";
const BACKUP_DIR = path.join(process.cwd(), "backups");
export interface BackupResult { ok: boolean; backupPath?: string; sizeBytes?: number; error?: string; }
export async function runBackup(): Promise<BackupResult> {
  logger.info("backup-service.start", {});
  const ts = new Date().toISOString().replace(/[:.]/g,"-").split("T")[0]+"_"+new Date().toISOString().replace(/[:.]/g,"-").split("T")[1].slice(0,5);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dbUrl = process.env.DATABASE_URL || ""; let dbBackupPath = "";
    if (dbUrl.startsWith("file:")) { const dbPath = dbUrl.replace("file:","").replace("./",""); const fullPath = path.resolve(process.cwd(), dbPath); dbBackupPath = path.join(BACKUP_DIR, `db-${ts}.sql.gz`); try { execSync(`sqlite3 "${fullPath}" .dump | gzip > "${dbBackupPath}"`, { timeout: 60_000, stdio: "pipe" }); } catch { try { execSync(`cp "${fullPath}" "${dbBackupPath.replace(".sql.gz",".db")}"`, { timeout: 30_000 }); dbBackupPath = dbBackupPath.replace(".sql.gz",".db"); } catch {} } }
    else if (dbUrl.startsWith("postgresql://")||dbUrl.startsWith("postgres://")) { dbBackupPath = path.join(BACKUP_DIR, `db-${ts}.sql.gz`); try { execSync(`pg_dump "${dbUrl}" | gzip > "${dbBackupPath}"`, { timeout: 120_000, stdio: "pipe" }); } catch {} }
    let sizeBytes = 0; if (dbBackupPath && fs.existsSync(dbBackupPath)) sizeBytes = fs.statSync(dbBackupPath).size;
    pruneOldBackups();
    try { await db.setting.upsert({ where: { key: "backup.lastBackup" }, create: { key: "backup.lastBackup", value: JSON.stringify({ timestamp: new Date().toISOString(), path: dbBackupPath, sizeBytes, ok: sizeBytes>0 }), category: "system" }, update: { value: JSON.stringify({ timestamp: new Date().toISOString(), path: dbBackupPath, sizeBytes, ok: sizeBytes>0 }) } }); } catch {}
    emit({ type: "system", ts: new Date().toISOString(), message: `✅ Backup complete: ${dbBackupPath} (${(sizeBytes/1024).toFixed(0)} KB)`, level: "success" });
    return { ok: sizeBytes>0, backupPath: dbBackupPath, sizeBytes };
  } catch (err) { logger.error("backup-service.failed", { error: String(err) }); return { ok: false, error: String(err) }; }
}
function pruneOldBackups(): void { try { const files = fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("db-")).map(f=>({name:f,path:path.join(BACKUP_DIR,f),mtime:fs.statSync(path.join(BACKUP_DIR,f)).mtime})).sort((a,b)=>b.mtime.getTime()-a.mtime.getTime()); const keep = new Set(files.slice(0,7).map(f=>f.path)); for (const f of files) { if (!keep.has(f.path)) { try { fs.unlinkSync(f.path); } catch {} } } } catch {} }
export async function getBackupStatus() { try { const s = await db.setting.findUnique({ where: { key: "backup.lastBackup" } }); return { lastBackup: s?JSON.parse(s.value):null }; } catch { return { lastBackup: null }; } }
