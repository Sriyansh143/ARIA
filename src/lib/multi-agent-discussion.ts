/**
 * multi-agent-discussion.ts — Multi-agent discussion + decision system.
 *
 * Multiple agents monitor tabs, discuss findings, vote on actions,
 * then implement. More robust than single-agent decision-making.
 *
 * Flow:
 *   1. CEO deploys C-Suite agents (CTO, CMO, COO, CFO) to monitor tabs.
 *   2. Each agent analyzes the tabs relevant to their domain.
 *   3. Agents propose actions based on their analysis.
 *   4. Agents discuss the proposals (round-robin, 2 rounds).
 *   5. CEO collects votes and reaches consensus.
 *   6. Winning actions are implemented (tasks created, commands executed).
 *   7. Discussion results logged to memory.
 *
 * Ported concept from jarvis zip's mnc-orchestrator.ts + hierarchical-orchestrator.ts.
 */

import { db } from '@/lib/db';
import { chat } from '@/lib/llm';
import { ceoClassify, type Department } from '@/lib/ceo-agent';

export interface AgentOpinion {
  agent: string;
  role: Department;
  tab: string;
  observation: string;
  proposedAction: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

export interface DiscussionResult {
  topic: string;
  participants: string[];
  opinions: AgentOpinion[];
  consensus: {
    action: string;
    agreedBy: string[];
    disagreedBy: string[];
    tasksToCreate: Array<{ title: string; description: string; assignee: string; priority: string }>;
  };
  round: number;
  logged: boolean;
}

const C_SUITE_AGENTS: Record<Department, { codename: string; role: string }> = {
  cto: { codename: 'ATLAS', role: 'Chief Technology Officer' },
  cmo: { codename: 'ECHO', role: 'Chief Marketing Officer' },
  coo: { codename: 'ORION', role: 'Chief Operating Officer' },
  cfo: { codename: 'APEX', role: 'Chief Financial Officer' },
};

/**
 * Run a multi-agent discussion on a specific topic/tab.
 * Each C-Suite agent provides their domain-specific perspective.
 */
export async function runDiscussion(topic: string, tabContext: Record<string, unknown>): Promise<DiscussionResult> {
  const participants = Object.values(C_SUITE_AGENTS).map(a => a.codename);
  const opinions: AgentOpinion[] = [];

  // Round 1: Each agent independently analyzes and proposes.
  for (const [dept, agent] of Object.entries(C_SUITE_AGENTS)) {
    const opinion = await getAgentOpinion(
      agent.codename,
      agent.role,
      dept as Department,
      topic,
      tabContext,
    );
    if (opinion) opinions.push(opinion);
  }

  // Round 2: Agents see each other's opinions and can adjust.
  const allOpinionsText = opinions.map(o =>
    `${o.agent} (${o.role}): ${o.observation} → Proposes: ${o.proposedAction} [${o.priority}]`
  ).join('\n');

  const adjustedOpinions: AgentOpinion[] = [];
  for (const opinion of opinions) {
    const adjusted = await adjustOpinion(opinion, allOpinionsText);
    adjustedOpinions.push(adjusted || opinion);
  }

  // CEO collects votes and reaches consensus.
  const consensus = await reachConsensus(topic, adjustedOpinions);

  // Create tasks from consensus.
  const tasksCreated: Array<{ title: string; description: string; assignee: string; priority: string }> = [];
  for (const taskSuggestion of consensus.tasksToCreate) {
    const agent = await db.agent.findFirst({
      where: { codename: taskSuggestion.assignee.toUpperCase() },
    });
    // Check for duplicates
    const existing = await db.task.findFirst({
      where: { title: { contains: taskSuggestion.title.slice(0, 50) } },
    });
    if (!existing) {
      await db.task.create({
        data: {
          title: taskSuggestion.title.slice(0, 200),
          description: taskSuggestion.description.slice(0, 2000),
          priority: taskSuggestion.priority,
          assigneeId: agent?.id || null,
          tags: JSON.stringify(['multi-agent-discussion', topic.slice(0, 30)]),
        },
      });
      tasksCreated.push(taskSuggestion);
    }
  }

  // Log discussion to memory.
  let logged = false;
  try {
    await db.memoryItem.create({
      data: {
        scope: 'episodic',
        key: `discussion-${Date.now()}`,
        value: JSON.stringify({
          topic,
          participants,
          opinions: adjustedOpinions,
          consensus: consensus.action,
          tasksCreated: tasksCreated.length,
        }, null, 2).slice(0, 10000),
        tags: JSON.stringify(['discussion', 'multi-agent', 'consensus']),
        pinned: false,
      },
    });
    logged = true;
  } catch { /* best-effort */ }

  // Create notification.
  await db.notification.create({
    data: {
      type: 'info',
      title: `Multi-Agent Discussion: ${topic.slice(0, 60)}`,
      message: `${participants.length} agents participated. Consensus: ${consensus.action.slice(0, 100)}. ${tasksCreated.length} tasks created.`,
    },
  }).catch(() => {});

  return {
    topic,
    participants,
    opinions: adjustedOpinions,
    consensus: { ...consensus, tasksToCreate: tasksCreated },
    round: 2,
    logged,
  };
}

/**
 * Get a single agent's opinion on a topic.
 */
async function getAgentOpinion(
  codename: string,
  role: string,
  department: Department,
  topic: string,
  context: Record<string, unknown>,
): Promise<AgentOpinion | null> {
  const contextStr = JSON.stringify(context).slice(0, 1000);
  const prompt = `You are ${codename}, the ${role} of an autonomous AI company. You are in a multi-agent discussion about:

TOPIC: ${topic}

CURRENT SYSTEM STATE:
${contextStr}

As the ${role}, analyze this from your department's perspective (${department}).
- What do you observe?
- What action should be taken?
- What priority is this?
- How confident are you (0-1)?

Respond in JSON only:
{"observation": "what you see", "proposedAction": "what to do", "priority": "low|medium|high|critical", "confidence": 0.0-1.0}`;

  try {
    const { content } = await chat(prompt, []);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        agent: codename,
        role: department,
        tab: topic,
        observation: parsed.observation || '',
        proposedAction: parsed.proposedAction || '',
        priority: parsed.priority || 'medium',
        confidence: parsed.confidence || 0.5,
      };
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Agent sees other opinions and can adjust their own.
 */
async function adjustOpinion(original: AgentOpinion, allOpinions: string): Promise<AgentOpinion | null> {
  const prompt = `You are ${original.agent} (${original.role}). You previously proposed:
"${original.proposedAction}" (priority: ${original.priority}, confidence: ${original.confidence})

Other agents' opinions:
${allOpinions}

Do you want to adjust your proposal based on what others said? If yes, provide your adjusted opinion. If no, repeat your original.

Respond in JSON only:
{"observation": "updated observation", "proposedAction": "updated action", "priority": "low|medium|high|critical", "confidence": 0.0-1.0}`;

  try {
    const { content } = await chat(prompt, []);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        ...original,
        observation: parsed.observation || original.observation,
        proposedAction: parsed.proposedAction || original.proposedAction,
        priority: parsed.priority || original.priority,
        confidence: parsed.confidence || original.confidence,
      };
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * CEO reaches consensus based on all agent opinions.
 */
async function reachConsensus(topic: string, opinions: AgentOpinion[]): Promise<{
  action: string;
  agreedBy: string[];
  disagreedBy: string[];
  tasksToCreate: Array<{ title: string; description: string; assignee: string; priority: string }>;
}> {
  const opinionsText = opinions.map(o =>
    `${o.agent} (${o.role}, confidence ${o.confidence}): ${o.proposedAction} [${o.priority}]`
  ).join('\n');

  const prompt = `You are the CEO of an autonomous AI company. Your C-Suite agents have discussed:

TOPIC: ${topic}

AGENT OPINIONS:
${opinionsText}

Reach a consensus decision:
1. Which action(s) should be taken?
2. Which agents agreed?
3. Which agents disagreed?
4. What specific tasks should be created?

Respond in JSON only:
{
  "action": "the consensus action",
  "agreedBy": ["AGENT1", "AGENT2"],
  "disagreedBy": ["AGENT3"],
  "tasksToCreate": [
    {"title": "task title", "description": "what to do", "assignee": "AGENT_CODENAME", "priority": "low|medium|high|critical"}
  ]
}`;

  try {
    const { content } = await chat(prompt, []);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch { /* fall through */ }

  // Fallback: use the highest-confidence opinion.
  const best = opinions.sort((a, b) => b.confidence - a.confidence)[0];
  return {
    action: best?.proposedAction || 'No consensus reached',
    agreedBy: best ? [best.agent] : [],
    disagreedBy: opinions.filter(o => o.agent !== best?.agent).map(o => o.agent),
    tasksToCreate: best ? [{
      title: best.proposedAction.slice(0, 200),
      description: best.observation,
      assignee: best.agent,
      priority: best.priority,
    }] : [],
  };
}

/**
 * Multi-agent tab sweep: deploy C-Suite agents to monitor tabs relevant to their domain.
 */
export async function multiAgentTabSweep(): Promise<{
  discussionsRun: number;
  tasksCreated: number;
  results: DiscussionResult[];
}> {
  const results: DiscussionResult[] = [];
  let tasksCreated = 0;

  // Define tab → department mapping
  const tabDiscussions = [
    {
      topic: 'Tasks tab health — are tasks being completed? What new tasks should be created?',
      context: async () => {
        const total = await db.task.count();
        const pending = await db.task.count({ where: { status: 'pending' } });
        const completed = await db.task.count({ where: { status: 'completed' } });
        const inProgress = await db.task.count({ where: { status: 'in_progress' } });
        return { total, pending, completed, inProgress };
      },
    },
    {
      topic: 'CRM & Sales — lead pipeline health, conversion rate, client acquisition strategy',
      context: async () => {
        const clients = await db.client.count().catch(() => 0);
        const leads = await db.lead.count().catch(() => 0);
        const tickets = await db.supportTicket.count().catch(() => 0);
        return { clients, leads, tickets };
      },
    },
    {
      topic: 'Earning methods — which methods are ready to offer? What research is needed?',
      context: async () => {
        const methods = await db.earningMethod.count().catch(() => 0);
        const approved = await db.earningMethod.count({ where: { approved: true } }).catch(() => 0);
        return { methods, approved };
      },
    },
  ];

  for (const discussion of tabDiscussions) {
    try {
      const context = await discussion.context();
      const result = await runDiscussion(discussion.topic, context);
      results.push(result);
      tasksCreated += result.consensus.tasksToCreate.length;
    } catch {
      // Best-effort: don't crash on one discussion failure
    }
  }

  return { discussionsRun: results.length, tasksCreated, results };
}
