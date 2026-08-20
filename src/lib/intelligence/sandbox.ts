import "server-only";
import fs from "fs"; import path from "path";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"; import { tmpdir } from "os";
import { logger } from "../logger";
export interface SandboxResult { success: boolean; errors: string[]; output?: string; duration: number; }

/**
 * Sandbox executor for agent-generated code.
 *
 * SECURITY FIXES (AUDIT-C-1, C-2, C-8, C-9):
 *  - Path-traversal protection: every file key is sanitized and the resolved
 *    path is asserted to remain inside `tempDir`. LLM-controlled filenames can
 *    no longer escape to arbitrary locations (which previously leaked files
 *    that the `finally` cleanup never reached).
 *  - `rmSync` failures are now logged (was empty catch) so temp-dir leaks are
 *    observable in long-running cron loops.
 *  - `node --check` now uses `execFileSync` (no shell) + `killSignal: SIGKILL`
 *    so a stuck parser cannot orphan a child holding the file FD.
 */
export async function executeInSandbox(files: Record<string, string>, serviceType: string): Promise<SandboxResult> {
  const start=Date.now(); const errors: string[]=[]; let output="";
  const tempDir=mkdtempSync(path.join(tmpdir(),"aria-sandbox-"));
  try {
    for (const [fn,content] of Object.entries(files)) {
      // AUDIT-C-1: reject path traversal / absolute paths before writing.
      if (fn.includes("..") || path.isAbsolute(fn) || fn.includes("\0")) {
        errors.push(`Unsafe file path rejected by sandbox: ${fn.slice(0,80)}`);
        continue;
      }
      const fp=path.join(tempDir,fn);
      // Defense-in-depth: resolved path must remain inside tempDir.
      const rel=path.relative(tempDir, fp);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        errors.push(`Sandbox escape attempt blocked: ${fn.slice(0,80)}`);
        continue;
      }
      const d=path.dirname(fp); if(!existsSync(d)) fs.mkdirSync(d,{recursive:true});
      writeFileSync(fp,content,"utf-8");
    }
    if (["landing-page","website-static","3d-website","dashboard"].includes(serviceType)) { const r=testHtml(files); errors.push(...r.errors); output=r.output; }
    else if (["api-service","api-docs"].includes(serviceType)) { const r=await testApi(files); errors.push(...r.errors); output=r.output; }
    else if (serviceType==="cli-tool") { const r=testCli(files); errors.push(...r.errors); output=r.output; }
    else if (serviceType==="saas-scaffold") { const r=testScaffold(files); errors.push(...r.errors); output=r.output; }
    else if (serviceType==="blog-post") { const r=testMd(files); errors.push(...r.errors); output=r.output; }
    else if (serviceType==="voice-agent") { const r=testTs(tempDir,files); errors.push(...r.errors); output=r.output; }
    return { success:errors.length===0, errors, output, duration:Date.now()-start };
  } catch (err) {
    return { success:false, errors:[`Sandbox failed: ${String(err).slice(0,150)}`], duration:Date.now()-start };
  } finally {
    // AUDIT-C-2: log cleanup failures instead of swallowing them silently.
    try { rmSync(tempDir,{recursive:true,force:true}); }
    catch (e) { logger.warn("sandbox.cleanup-failed",{ tempDir, error: String(e) }); }
  }
}
function testHtml(files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[]; const h=files["index.html"]||Object.entries(files).find(([k])=>k.endsWith(".html"))?.[1];
  if(!h){e.push("No index.html");return{errors:e,output:""}}
  if(!/<!DOCTYPE html>/i.test(h))e.push("Missing DOCTYPE"); if(!/<html/i.test(h))e.push("Missing <html>"); if(!/<title/i.test(h))e.push("Missing <title>");
  if(!/name=["']viewport["']/i.test(h))e.push("Missing viewport meta");
  const open=(h.match(/<(div|section|article|header|footer|nav|main|p|h[1-6])\b[^>]*>/gi)||[]).length; const close=(h.match(/<\/(div|section|article|header|footer|nav|main|p|h[1-6])>/gi)||[]).length;
  if(Math.abs(open-close)>3)e.push(`Tag imbalance: ${open} open, ${close} close`);
  return{errors:e,output:`HTML: ${open} tags checked`};
}
function testApi(files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[];
  if(!files["server.ts"]&&!files["server.js"]&&!files["index.ts"]&&!files["index.js"])e.push("No server file");
  if(!files["package.json"])e.push("No package.json"); else try{JSON.parse(files["package.json"])}catch{e.push("Invalid package.json")}
  return{errors:e,output:"API: checked"};
}
function testCli(files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[];
  if(!files["cli.ts"]&&!files["cli.js"]&&!files["index.ts"]&&!files["index.js"])e.push("No CLI file");
  if(!files["README.md"])e.push("Missing README");
  return{errors:e,output:"CLI: checked"};
}
function testScaffold(files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[];
  if(!files["package.json"])e.push("No package.json"); if(!files["README.md"])e.push("No README");
  return{errors:e,output:"Scaffold: checked"};
}
function testMd(files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[]; const m=files["blog-post.md"]||Object.entries(files).find(([k])=>k.endsWith(".md"))?.[1];
  if(!m){e.push("No markdown");return{errors:e,output:""}} if(m.length<500)e.push("Too short"); if(!/^#{1,6}\s/m.test(m))e.push("No headings");
  return{errors:e,output:`MD: ${m?.length||0} chars`};
}
function testTs(dir: string, files: Record<string,string>): {errors:string[];output:string} { const e:string[]=[];
  for(const [fn,content] of Object.entries(files)) {
    if(fn.endsWith(".ts")||fn.endsWith(".tsx")) {
      const jp=path.join(dir,`_${fn.replace(/[^a-zA-Z0-9.]/g,"_")}.js`);
      // NOTE: this naive TS-strip remains syntax-only. Trajectory validation
      // (actual execution + behavioural assertions) is tracked as AUDIT-B-13
      // and is a v59 roadmap item — wiring Playwright/tsc is out of scope here.
      const jc=content.replace(/import\s+.*?from\s+['"][^'"]+['"];?/g,"").replace(/export\s+/g,"").replace(/:\s*(string|number|boolean|any|void)\b/gi,"");
      writeFileSync(jp,jc,"utf-8");
      try{
        // AUDIT-C-8/C-9: execFileSync (no shell injection) + SIGKILL on timeout.
        execFileSync("node",["--check",jp],{timeout:5000,stdio:"pipe",killSignal:"SIGKILL"});
      }catch(err){e.push(`${fn}: syntax error`)}
    }
  }
  return{errors:e,output:`TS: ${Object.keys(files).filter(f=>f.endsWith(".ts")).length} files`};
}
