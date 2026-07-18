// Pure content categorization — no DB / server-only imports so this module
// can be imported from client components as well as server routes.
//
// Used by:
//   - src/lib/teach-source.ts (server) to suggest a target section on ingest
//   - src/app/api/learning/auto-categorize/route.ts (POST + GET rules)
//   - src/app/api/learning/auto-move/route.ts (scan + move)
//   - src/components/tabs/LearningTab.tsx (client-side suggested badge)

export type TargetSection =
  | 'skill'
  | 'plugin'
  | 'memory'
  | 'knowledge'
  | 'intelligence'
  | 'learning';

export const TARGET_SECTIONS: TargetSection[] = [
  'skill',
  'plugin',
  'memory',
  'knowledge',
  'intelligence',
  'learning',
];

export const TARGET_SECTION_LABELS: Record<TargetSection, string> = {
  skill: 'Skill',
  plugin: 'Plugin',
  memory: 'Memory',
  knowledge: 'Knowledge',
  intelligence: 'Intelligence',
  learning: 'Learning',
};

export const TARGET_SECTION_DESCRIPTIONS: Record<TargetSection, string> = {
  skill: 'Code snippets, functions, classes, reusable implementation know-how',
  plugin: 'Integration / API / config patterns, SDKs, webhooks, credentials',
  memory: 'Personal / conversational / episodic recollections and preferences',
  knowledge: 'Factual / reference info, definitions, lists, documentation',
  intelligence: 'Strategic / analytical insights, forecasts, recommendations',
  learning: 'Default bucket — uncategorized learning items pending review',
};

export interface AutoCategorizeResult {
  suggestedSection: TargetSection;
  confidence: number; // 0..1
  reason: string;
  scores: Record<TargetSection, number>;
}

interface RuleHit {
  section: TargetSection;
  delta: number;
  reason: string;
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/** Analyze a content string and suggest the best target section. Pure / sync. */
export function autoCategorize(content: string): AutoCategorizeResult {
  const text = (content || '').toLowerCase();
  const scores: Record<TargetSection, number> = {
    skill: 0,
    plugin: 0,
    memory: 0,
    knowledge: 0,
    intelligence: 0,
    learning: 0,
  };
  const reasons: Record<TargetSection, string[]> = {
    skill: [],
    plugin: [],
    memory: [],
    knowledge: [],
    intelligence: [],
    learning: [],
  };

  if (!text.trim()) {
    return {
      suggestedSection: 'learning',
      confidence: 0,
      reason: 'empty content',
      scores,
    };
  }

  const hits: RuleHit[] = [];

  // --- Skill: code fences + code-like keywords ---
  const codeFenceMatches = text.match(/```[\s\S]*?```/g) || [];
  if (codeFenceMatches.length > 0) {
    hits.push({
      section: 'skill',
      delta: 3 * codeFenceMatches.length,
      reason: `${codeFenceMatches.length} code fence block(s)`,
    });
  }
  const codeKeywordCount = countMatches(
    text,
    /\b(function|class|def |const |let |var |return |import |export |interface |type |async |await |=>|public |private |protected |namespace|impl|fn |func )\b/g,
  );
  if (codeKeywordCount >= 3) {
    hits.push({
      section: 'skill',
      delta: Math.min(8, codeKeywordCount / 2),
      reason: `${codeKeywordCount} code-like keyword(s)`,
    });
  }
  const fileExtHints = countMatches(
    text,
    /\.(ts|tsx|js|jsx|py|rs|go|java|kt|c|cpp|h|hpp|rb|php|swift|sh|yml|yaml|toml|sql)\b/g,
  );
  if (fileExtHints >= 2) {
    hits.push({
      section: 'skill',
      delta: Math.min(4, fileExtHints),
      reason: `${fileExtHints} file-extension reference(s)`,
    });
  }

  // --- Plugin: integration / API / config patterns ---
  const pluginCount = countMatches(
    text,
    /\b(api[\s_-]?key|base[\s_-]?url|endpoint|webhook|oauth|bearer|authorization|config(?:uration)?|\.env|integrate|integration|sdk|client[\s_-]?id|access[\s_-]?token|rest|graphql|grpc|header|content-type|post|get |put |delete )\b/g,
  );
  if (pluginCount >= 2) {
    hits.push({
      section: 'plugin',
      delta: Math.min(8, pluginCount),
      reason: `${pluginCount} integration/config keyword(s)`,
    });
  }
  // JSON-like config payload
  const jsonLike = /^\s*[\{\[][\s\S]*[\}\]]\s*$/m.test(text);
  if (jsonLike) {
    hits.push({ section: 'plugin', delta: 2, reason: 'JSON-like config payload' });
  }
  // env-style KEY=value pairs
  const envPairs = countMatches(text, /\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g);
  if (envPairs >= 2) {
    hits.push({
      section: 'plugin',
      delta: Math.min(4, envPairs),
      reason: `${envPairs} env-style KEY=value pair(s)`,
    });
  }

  // --- Knowledge: factual / reference info ---
  const knowledgeCount = countMatches(
    text,
    /\b(definition|means|refers to|is defined as|aka|also known as|note that|according to|in other words|for example|such as|e\.g\.|i\.e\.|reference|documentation|wikipedia|source:|defined by|known as|literally)\b/g,
  );
  if (knowledgeCount >= 2) {
    hits.push({
      section: 'knowledge',
      delta: Math.min(7, knowledgeCount),
      reason: `${knowledgeCount} reference/factual marker(s)`,
    });
  }
  const hasBulletList = /\n\s*[-*]\s+/m.test(text);
  const hasNumList = /\n\s*\d+\.\s+/m.test(text);
  if (hasBulletList || hasNumList) {
    hits.push({
      section: 'knowledge',
      delta: 1,
      reason: 'list/reference structure',
    });
  }
  // factual numbers / dates / units
  const factCount = countMatches(
    text,
    /\b(\d{4}\s*(ad|bc|ce)?|\d+(\.\d+)?\s*(kg|km|cm|mm|m|s|ms|hz|mb|gb|tb|fps|rpm|°c|°f|%|percent))\b/g,
  );
  if (factCount >= 3) {
    hits.push({
      section: 'knowledge',
      delta: Math.min(3, factCount / 2),
      reason: `${factCount} numeric/factual figure(s)`,
    });
  }

  // --- Intelligence: strategic / analytical insights ---
  const intelCount = countMatches(
    text,
    /\b(strategy|strategic|analysis|analyze|insight|forecast|predict|projection|hypothesis|recommend|should|because|therefore|consequently|in conclusion|risk|opportunity|leverage|optimize|kpi|metric|outcome|impact|trade-?off|prioritize|roadmap|vision|objective)\b/g,
  );
  if (intelCount >= 2) {
    hits.push({
      section: 'intelligence',
      delta: Math.min(8, intelCount),
      reason: `${intelCount} strategic/analytical keyword(s)`,
    });
  }
  // comparative / superlative phrasing
  const comparativeCount = countMatches(
    text,
    /\b(better|worse|best|worst|more important|less important|priority|versus|vs\.?|compared to|trade-?off)\b/g,
  );
  if (comparativeCount >= 2) {
    hits.push({
      section: 'intelligence',
      delta: Math.min(3, comparativeCount),
      reason: `${comparativeCount} comparative/judgment marker(s)`,
    });
  }

  // --- Memory: conversational / personal ---
  const memoryCount = countMatches(
    text,
    /\b(i|i'm|i've|i'd|i'll|me|my|mine|we|us|our|ours|yesterday|today|tomorrow|remember|forgot|met with|talked to|told|said|conversation|personal|preference|like|hate|feel|felt|wish|want|need to|reminder|birthday|anniversary)\b/g,
  );
  if (memoryCount >= 3) {
    hits.push({
      section: 'memory',
      delta: Math.min(6, memoryCount / 2),
      reason: `${memoryCount} first-person/conversational marker(s)`,
    });
  }
  // past-tense narrative
  const narrativeCount = countMatches(
    text,
    /\b(went|saw|did|had|was|were|said|told|met|called|emailed|decided|finished|started|stopped|visited|watched|read|heard)\b/g,
  );
  if (narrativeCount >= 3) {
    hits.push({
      section: 'memory',
      delta: Math.min(3, narrativeCount / 2),
      reason: `${narrativeCount} past-tense narrative marker(s)`,
    });
  }

  // Apply hits to scores + reasons.
  for (const h of hits) {
    scores[h.section] += h.delta;
    reasons[h.section].push(h.reason);
  }

  // Default learning baseline (so unset content lands here).
  scores.learning += 1;

  // Pick highest-scoring section. Ties break toward the order in
  // TARGET_SECTIONS (skill < plugin < memory < knowledge < intelligence <
  // learning) — first-wins, which favors more specific buckets.
  let best: TargetSection = 'learning';
  let bestScore = scores.learning;
  for (const section of TARGET_SECTIONS) {
    if (scores[section] > bestScore) {
      best = section;
      bestScore = scores[section];
    }
  }

  const totalScore =
    Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const confidence = Math.max(0, Math.min(1, bestScore / totalScore));

  const reason =
    reasons[best].length > 0
      ? reasons[best].join('; ')
      : 'no strong markers — defaulted to learning';

  return {
    suggestedSection: best,
    confidence,
    reason,
    scores,
  };
}

/** Return the rule catalog (used by GET /api/learning/auto-categorize). */
export function getCategoryRules() {
  return TARGET_SECTIONS.map((s) => ({
    section: s,
    label: TARGET_SECTION_LABELS[s],
    description: TARGET_SECTION_DESCRIPTIONS[s],
  }));
}
