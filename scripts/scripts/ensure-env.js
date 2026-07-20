// ensure-env.js — Auto-creates .env file + runs prisma generate + db push
// This runs automatically before `npm run dev` and after `npm install`.
// It ensures the app can ALWAYS start, even on a fresh clone.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── Step 0: Node.js version preflight (FEAT-3) ─────────────────────
// Runs BEFORE anything else so an old Node version doesn't produce cryptic
// prisma generate / TypeScript errors. Inline the check (instead of spawning
// the separate scripts/check-node-version.js) so it works even when running
// ensure-env.js standalone without the npm predev hook.
;(function checkNodeVersion() {
  const REQUIRED_MAJOR = 20
  const match = /^v?(\d+)\./.exec(process.version)
  const major = match ? parseInt(match[1], 10) : null
  if (major !== null && major < REQUIRED_MAJOR) {
    console.error('')
    console.error('╔══════════════════════════════════════════════════════════════════╗')
    console.error('║  JARVIS Mission Control — Node.js version too old              ║')
    console.error('╚══════════════════════════════════════════════════════════════════╝')
    console.error('')
    console.error(`  Your Node.js version:  ${process.version}`)
    console.error(`  Required version:      >=${REQUIRED_MAJOR}.0.0`)
    console.error('')
    console.error('  Download Node.js ' + REQUIRED_MAJOR + '+ from https://nodejs.org/')
    console.error('  Or use nvm:')
    console.error('    nvm install ' + REQUIRED_MAJOR + ' && nvm use ' + REQUIRED_MAJOR)
    console.error('')
    process.exit(1)
  }
})()

const envPath = path.join(process.cwd(), '.env')
const envExamplePath = path.join(process.cwd(), '.env.example')

// ─── Step 1: Create .env if it doesn't exist ────────────────────────
if (!fs.existsSync(envPath)) {
  console.log('[ensure-env] .env not found — creating from .env.example...')
  if (fs.existsSync(envExamplePath)) {
    // Copy .env.example but uncomment the critical lines
    let content = fs.readFileSync(envExamplePath, 'utf8')
    // Extract just the DATABASE_URL line and make sure it's uncommented
    const lines = content.split('\n')
    const envLines = []
    let inCommentBlock = false
    for (const line of lines) {
      // Skip comment-only lines (keep the ones with actual values)
      if (line.trim().startsWith('#') && !line.includes('=')) {
        envLines.push(line)
        continue
      }
      // Uncomment critical env vars
      if (line.match(/^#\s*DATABASE_URL/)) {
        envLines.push('DATABASE_URL="file:./prisma/jarvis.db"')
        continue
      }
      if (line.match(/^#\s*NODE_ENV/)) {
        envLines.push('NODE_ENV=development')
        continue
      }
      if (line.match(/^#\s*DASHBOARD_BASE/)) {
        envLines.push('DASHBOARD_BASE=http://127.0.0.1:3000')
        continue
      }
      if (line.match(/^#\s*NEXTAUTH_URL/)) {
        envLines.push('NEXTAUTH_URL=http://127.0.0.1:3000')
        continue
      }
      if (line.match(/^#\s*NEXTAUTH_SECRET/)) {
        envLines.push('NEXTAUTH_SECRET=jarvis-dev-secret-change-in-production-32chars')
        continue
      }
      if (line.match(/^#\s*JARVIS_ALLOWED_ORIGINS/)) {
        envLines.push('JARVIS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000')
        continue
      }
      envLines.push(line)
    }
    fs.writeFileSync(envPath, envLines.join('\n'))
    console.log('[ensure-env] ✅ .env created with default values')
  } else {
    // No .env.example either — create a minimal .env
    const minimalEnv = `# JARVIS Mission Control .env (auto-created)
DATABASE_URL="file:./prisma/jarvis.db"
NODE_ENV=development
DASHBOARD_BASE=http://127.0.0.1:3000
NEXTAUTH_URL=http://127.0.0.1:3000
NEXTAUTH_SECRET=jarvis-dev-secret-change-in-production-32chars
JARVIS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
`
    fs.writeFileSync(envPath, minimalEnv)
    console.log('[ensure-env] ✅ .env created with minimal defaults')
  }
} else {
  // .env exists — check if DATABASE_URL is set
  const envContent = fs.readFileSync(envPath, 'utf8')
  if (!envContent.includes('DATABASE_URL=') || envContent.match(/^DATABASE_URL=\s*$/m)) {
    console.log('[ensure-env] DATABASE_URL missing in .env — adding it...')
    const append = '\nDATABASE_URL="file:./prisma/jarvis.db"\n'
    fs.appendFileSync(envPath, append)
    console.log('[ensure-env] ✅ DATABASE_URL added to .env')
  }
}

// ─── Step 2: Run prisma generate ────────────────────────────────────
try {
  console.log('[ensure-env] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit', cwd: process.cwd() })
  console.log('[ensure-env] ✅ Prisma client generated')
} catch (err) {
  console.error('[ensure-env] ⚠️ prisma generate failed (non-fatal):', err.message)
  console.error('[ensure-env]    Run "npx prisma generate" manually after install')
}

// ─── Step 3: Run prisma db push (creates SQLite DB + tables) ────────
try {
  console.log('[ensure-env] Running prisma db push (creates database tables)...')
  execSync('npx prisma db push', { stdio: 'inherit', cwd: process.cwd() })
  console.log('[ensure-env] ✅ Database created + all tables pushed')
} catch (err) {
  console.error('[ensure-env] ⚠️ prisma db push failed (non-fatal):', err.message)
  console.error('[ensure-env]    Run "npx prisma db push" manually')
}

// ─── Step 4: Create required directories ────────────────────────────
const requiredDirs = [
  'prisma',
  'download',
  'download/artifacts',
  'logs',
  'mini-services/browser-login/sessions',
  'mini-services/process-manager/logs',
]
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir)
  if (!fs.existsSync(dirPath)) {
    try { fs.mkdirSync(dirPath, { recursive: true }) } catch {}
  }
}
console.log('[ensure-env] ✅ Required directories created')

// ─── Step 5: Repair native binaries (SWC + lightningcss) ────────────
// Phase 44 fix: Windows native binaries for @next/swc and lightningcss
// can get corrupted during npm install, causing Turbopack crashes and
// "Cannot find module '../lightningcss.win32-x64-msvc.node'" errors.
const fixScriptPath = path.join(process.cwd(), 'scripts', 'fix-native-binaries.js')
if (fs.existsSync(fixScriptPath) && fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
  try {
    console.log('[ensure-env] Checking native binaries (SWC + lightningcss)...')
    execSync('node scripts/fix-native-binaries.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 180000, // 3 minutes max
    })
    console.log('[ensure-env] ✅ Native binaries verified')
  } catch (err) {
    console.error('[ensure-env] ⚠️ Native binary check failed (non-fatal):', err.message)
    console.error('[ensure-env]    Run "node scripts/fix-native-binaries.js" manually')
    console.error('[ensure-env]    Or use: npm run dev:webpack (bypasses SWC)')
  }
}

// ─── Step 5.5: Reap orphaned running tasks (BUG-2-5) ─────────────────
// If the previous JARVIS process crashed mid-task, those tasks stay in the
// 'running' state forever and the dashboard shows phantom in-progress work.
// This best-effort call marks any task that's been 'running' for >30min as
// 'failed' with an "orphaned" error message. Runs BEFORE seeding so the
// fresh boot starts with a clean task table. Wrapped in try/catch so a DB
// error here never blocks startup.
const reapScriptPath = path.join(process.cwd(), 'scripts', 'reap-orphaned-tasks.ts')
const reapTsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (fs.existsSync(reapScriptPath) && fs.existsSync(reapTsxPath)) {
  try {
    console.log('[ensure-env] Reaping orphaned running tasks (BUG-2-5)...')
    execSync(`node "${reapTsxPath}" scripts/reap-orphaned-tasks.ts`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 30000,
    })
    console.log('[ensure-env] ✅ Orphaned-task reaper ran')
  } catch (err) {
    console.error('[ensure-env] ⚠️ Orphaned-task reaper failed (non-fatal):', err.message)
    console.error('[ensure-env]    Run "npm run reap-tasks" manually')
  }
}

// ─── Step 6: Seed agents + workflows (Phase 46) ─────────────────────
// Ensures the database has agents (Hermes, UFO, Open Interpreter, etc.),
// skills, memories, and workflows. Without this, the Fleet tab and
// Workflows tab are empty.
//
// FIX: Previously this ran on EVERY `npm run dev` boot, which meant any
// data the user deleted (via `del prisma\jarvis.db` or the reset script)
// would be immediately re-seeded on next boot — making "reset" appear to
// not work. Now we check for a `prisma/.seeded` marker file (mirroring
// the Docker entrypoint pattern) and skip seeding if it exists.
const seedScriptPath = path.join(process.cwd(), 'scripts', 'seed.ts')
const seedWorkflowsPath = path.join(process.cwd(), 'scripts', 'seed-workflows.ts')
const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
const seededMarker = path.join(process.cwd(), 'prisma', '.seeded')
const forceReseed = process.env.JARVIS_FORCE_RESEED === 'true'

const shouldSeed = !fs.existsSync(seededMarker) || forceReseed

if (shouldSeed && fs.existsSync(seedScriptPath) && fs.existsSync(tsxPath)) {
  try {
    console.log('[ensure-env] Seeding agents + skills + memories (first boot or after reset)...')
    execSync(`node "${tsxPath}" scripts/seed.ts`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 60000,
    })
    console.log('[ensure-env] ✅ Agents + skills + memories seeded')
  } catch (err) {
    console.error('[ensure-env] ⚠️ Seeding agents failed (non-fatal):', err.message)
    console.error('[ensure-env]    Run "npx tsx scripts/seed.ts" manually')
  }
} else if (!shouldSeed) {
  console.log('[ensure-env] ⏭️  Skipping seed (prisma/.seeded marker exists — DB already seeded)')
  console.log('[ensure-env]    To force re-seed: delete prisma/.seeded or set JARVIS_FORCE_RESEED=true')
} else {
  console.log('[ensure-env] Skipping seed (tsx or seed.ts not found)')
}

let workflowsSeededOk = false
if (shouldSeed && fs.existsSync(seedWorkflowsPath) && fs.existsSync(tsxPath)) {
  try {
    console.log('[ensure-env] Seeding workflows...')
    execSync(`node "${tsxPath}" scripts/seed-workflows.ts`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 60000,
    })
    console.log('[ensure-env] ✅ Workflows seeded')
    workflowsSeededOk = true
  } catch (err) {
    console.error('[ensure-env] ⚠️ Seeding workflows failed (non-fatal):', err.message)
    console.error('[ensure-env]    Run "npx tsx scripts/seed-workflows.ts" manually')
  }
}

// FIX: Write the .seeded marker ONLY after BOTH seed.ts AND seed-workflows.ts
// have completed (success or failure). Previously the marker was written
// after seed.ts only — so a seed-workflows.ts failure would permanently
// skip reseeding on next boot, leaving the user with no workflows.
if (shouldSeed) {
  try {
    fs.writeFileSync(seededMarker, JSON.stringify({
      seededAt: new Date().toISOString(),
      agentsSeeded: true,
      workflowsSeeded: workflowsSeededOk,
    }, null, 2), 'utf8')
    if (!workflowsSeededOk) {
      console.warn('[ensure-env] ⚠️  Marker written but workflows seed failed — will retry on next boot unless marker exists')
      console.warn('[ensure-env]     Delete prisma/.seeded to force full reseed')
    }
  } catch {}
}

console.log('[ensure-env] 🚀 Environment ready — starting JARVIS...')
