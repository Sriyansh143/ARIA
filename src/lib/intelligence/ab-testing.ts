import "server-only";
import { createHash } from "crypto";
import { db } from "../db"; import { logger } from "../logger";
const MIN=50;

/**
 * Deterministic, unbiased A/B variant assignment.
 *
 * SECURITY FIX (AUDIT-B-12): the previous implementation summed char codes
 * (`leadId.split("").reduce(...)`) which is (a) commutative → massive collision
 * rate ("abc"=="bca"), (b) saltless → predictable, an adversary could choose
 * lead IDs that always bucket to A, and (c) modulo-biased on parity.
 *
 * We now use SHA-256(salt + testName + leadId) truncated to 32 bits, then map
 * to [0,1) via hash / 2^32 — this is the standard unbiased bucketing used by
 * LaunchDarkly / Statsig / GrowthBook. The salt defaults to the test name +
 * process.env.AB_TEST_SALT so the same lead gets a stable but test-specific
 * bucket (preventing correlated exposure across tests).
 */
function hashBucket(salt: string, testName: string, leadId: string): number {
  const h = createHash("sha256").update(`${salt}:${testName}:${leadId}`).digest();
  // Take the first 4 bytes as an unsigned 32-bit int, divide by 2^32 → [0,1).
  const u32 = (h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3];
  return (u32 >>> 0) / 0x100000000;
}

export async function assignVariant(testName: string, category: string, leadId: string): Promise<{testId:string;variant:"A"|"B"}|null> {
  try { const tests=await db.aBTest.findMany({where:{name:testName,category,status:"running"}}); if(tests.length<2)return null;
    const salt = process.env.AB_TEST_SALT || testName;
    const bucket = hashBucket(salt, testName, leadId);
    const v: "A"|"B" = bucket < 0.5 ? "A" : "B";
    const t=tests.find(x=>x.variant===v)||tests[0];
    return {testId:t.id, variant:t.variant as "A"|"B"};
  } catch (err) { logger.warn("ab-testing.assign-failed",{testName,error:String(err)}); return null; }
}
export async function recordOutcome(testId: string, success: boolean): Promise<void> {
  try { await db.aBTest.update({where:{id:testId},data:{sampleSize:{increment:1},successes:{increment:success?1:0}}}); await checkWinner(testId); } catch (err) { logger.warn("ab-testing.record-failed",{testId,error:String(err)}); }
}
async function checkWinner(testId: string): Promise<void> {
  try { const t=await db.aBTest.findUnique({where:{id:testId}}); if(!t||t.status!=="running"||t.sampleSize<MIN)return;
    const p=await db.aBTest.findFirst({where:{name:t.name,variant:{not:t.variant},status:"running"}}); if(!p||p.sampleSize<MIN)return;
    const ra=t.successes/t.sampleSize; const rb=p.successes/p.sampleSize;
    const wid=ra>=rb?t.id:p.id; const lid=ra>=rb?p.id:t.id;
    await db.aBTest.update({where:{id:wid},data:{status:"winner",completedAt:new Date()}});
    await db.aBTest.update({where:{id:lid},data:{status:"completed",completedAt:new Date()}});
  } catch (err) { logger.warn("ab-testing.check-winner-failed",{testId,error:String(err)}); }
}
export async function getWinningVariant(category: string): Promise<string|null> { try { const w=await db.aBTest.findFirst({where:{category,status:"winner"},orderBy:{completedAt:"desc"}}); return w?.content||null; } catch { return null; } }
