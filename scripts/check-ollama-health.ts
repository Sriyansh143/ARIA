/**
 * scripts/check-ollama-health.ts — v77.3
 *
 * Checks Ollama health + auto-pulls missing models.
 * Run during setup.sh or manually: bun run scripts/check-ollama-health.ts
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const REQUIRED_MODELS = [
  "llama3.2:3b",
  "nomic-embed-text",
  "qwen2.5-coder:7b",
  "qwen2.5vl:3b",
];

async function checkOllamaHealth() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  ARIA Mission Control — Ollama Health Check");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Ollama URL: ${OLLAMA_HOST}`);
  console.log("");

  // Step 1: Check if Ollama is running
  console.log("📋 Step 1: Checking if Ollama is running...");
  let tags: any[] = [];
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tags = data.models || [];
    console.log(`  ✅ Ollama is running. ${tags.length} models available.`);
  } catch (err: any) {
    console.log(`  ❌ Ollama is NOT running or unreachable: ${err.message}`);
    console.log("");
    console.log("  FIX:");
    console.log("    Windows: Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden");
    console.log("    Linux:   sudo systemctl start ollama");
    console.log("    Mac:     brew services start ollama");
    console.log("");
    console.log("  After starting Ollama, run this script again to pull models.");
    process.exit(1);
  }

  // Step 2: Check which required models are present
  console.log("");
  console.log("📋 Step 2: Checking required models...");
  const installed = tags.map((m: any) => m.name);
  const missing: string[] = [];

  for (const model of REQUIRED_MODELS) {
    // Ollama sometimes appends :latest — check both
    const found = installed.some((name: string) => name === model || name === `${model}:latest` || name.startsWith(model));
    if (found) {
      const modelData = tags.find((m: any) => m.name === model || m.name === `${model}:latest` || m.name.startsWith(model));
      console.log(`  ✅ ${model} — ${modelData?.size ? (modelData.size / 1e9).toFixed(1) + ' GB' : 'installed'}`);
    } else {
      console.log(`  ❌ ${model} — NOT INSTALLED`);
      missing.push(model);
    }
  }

  // Step 3: Auto-pull missing models
  if (missing.length > 0) {
    console.log("");
    console.log(`📋 Step 3: Pulling ${missing.length} missing models...`);
    console.log("  (This may take several minutes per model depending on your internet speed)");
    console.log("");

    for (const model of missing) {
      console.log(`  Pulling ${model}...`);
      try {
        const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(600_000), // 10 min per model
        });
        if (res.ok) {
          console.log(`  ✅ ${model} pulled successfully.`);
        } else {
          console.log(`  ⚠️ ${model} pull returned HTTP ${res.status}`);
        }
      } catch (err: any) {
        console.log(`  ❌ Failed to pull ${model}: ${err.message}`);
      }
    }
  } else {
    console.log("");
    console.log("  ✅ All required models are installed.");
  }

  // Step 4: Final verification
  console.log("");
  console.log("📋 Step 4: Final verification...");
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    const data = await res.json();
    const finalModels = (data.models || []).map((m: any) => m.name);
    const stillMissing = REQUIRED_MODELS.filter(m => !finalModels.some((n: string) => n === m || n === `${m}:latest` || n.startsWith(m)));
    if (stillMissing.length === 0) {
      console.log("  ✅ All models verified. Ollama is ready.");
      console.log("");
      console.log("══════════════════════════════════════════════════════════════");
      console.log("  ✅ OLLAMA HEALTHY — all models installed");
      console.log("══════════════════════════════════════════════════════════════");
    } else {
      console.log(`  ⚠️ Still missing: ${stillMissing.join(", ")}`);
      console.log("");
      console.log("  Manual pull:");
      stillMissing.forEach(m => console.log(`    ollama pull ${m}`));
      process.exit(1);
    }
  } catch (err) {
    console.log("  ❌ Final verification failed");
    process.exit(1);
  }
}

checkOllamaHealth().catch(err => {
  console.error("❌ Health check failed:", err.message);
  process.exit(1);
});
