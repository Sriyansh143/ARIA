/**
 * ceo-agent.ts — CEO agent that monitors all tabs and generates tasks autonomously.
 *
 * Ported from jarvis-mission-control-final.zip's mnc-orchestrator.ts,
 * adapted for this app. The CEO:
 *   1. Monitors each tab for emptiness or opportunities.
 *   2. Classifies what needs to be done (CTO/CMO/COO/CFO domain).
 *   3. Generates tasks with assignees and step-by-step processes.
 *   4. Researches earning methods → simulates → creates lead-gen pipeline.
 *   5. Requests approval via notifications (Telegram-compatible).
 *
 * Rules:
 *   - Never build from scratch — always use jarvis zip + open-source code.
 *   - Only approvals needed from owner (via Telegram).
 *   - Everything else is autonomous.
 */

import { db } from '@/lib/db';
import { chat } from '@/lib/llm';

export type Department = 'cto' | 'cmo' | 'coo' | 'cfo';
export type SpecialistRole = 'researcher' | 'coder' | 'reviewer' | 'writer' | 'tester' | 'analyst';

const DEPARTMENT_SPECIALISTS: Record<Department, SpecialistRole[]> = {
  cto: ['coder', 'reviewer', 'tester'],
  cmo: ['writer', 'researcher'],
  coo: ['researcher', 'writer', 'analyst'],
  cfo: ['analyst', 'writer'],
};

const DEPARTMENT_AGENTS: Record<Department, string[]> = {
  cto: ['ATLAS', 'CRONOS', 'FORGE', 'DAEDALUS', 'LABYRINTH'],
  cmo: ['ECHO', 'ANTARES', 'AQUILA', 'ANDROMEDA', 'CALLIOPE'],
  coo: ['ORION', 'HERMES', 'CENTAURUS', 'HYPERION', 'CLIO'],
  cfo: ['APEX', 'HALCYON', 'GAIA', 'BASTION'],
};

export interface CEOAnalysis {
  tab: string;
  status: 'empty' | 'stale' | 'opportunity' | 'healthy' | 'action-needed';
  observations: string[];
  recommendations: Array<{
    action: string;
    department: Department;
    priority: 'low' | 'medium' | 'high' | 'critical';
    suggestedTasks: Array<{ title: string; assignee: string; description: string }>;
  }>;
}

/**
 * CEO analyzes a tab and decides what needs to be done.
 * If a tab is empty, the CEO thinks about what it's for and generates tasks.
 */
export async function analyzeTab(tabKey: string, tabLabel: string, tabData: unknown): Promise<CEOAnalysis> {
  const dataStr = typeof tabData === 'object' && tabData !== null
    ? JSON.stringify(tabData).slice(0, 2000)
    : String(tabData ?? 'empty').slice(0, 500);

  const isEmpty = !dataStr || dataStr === 'empty' || dataStr === '[]' || dataStr === '{}' || dataStr === '"[]"';

  const prompt = `You are the CEO of an autonomous AI company (Liafon Software Pvt Ltd). You are monitoring the "${tabLabel}" tab (${tabKey}).

Current tab data: ${dataStr}

Your job:
1. Assess the state of this tab (empty? stale? has opportunities? needs action?)
2. If empty: what is this tab FOR? What should be in it? Generate tasks to populate it.
3. If has data: what opportunities or issues do you see? What should be done next?
4. Think about how this tab connects to the company's earning potential.

Company context:
- We offer 20 AI-powered services (web dev, app dev, SEO, content writing, social media, CRM setup, etc.)
- We have 68 specialist agents across engineering, marketing, operations, finance.
- We earn by completing tasks for clients (lead gen → outreach → proposal → delivery → payment).
- All tasks should eventually lead to revenue.

Respond in JSON only:
{
  "status": "empty|stale|opportunity|healthy|action-needed",
  "observations": ["observation 1", "observation 2"],
  "recommendations": [
    {
      "action": "what to do",
      "department": "cto|cmo|coo|cfo",
      "priority": "low|medium|high|critical",
      "suggestedTasks": [
        {"title": "task title", "assignee": "AGENT_CODENAME", "description": "what to do step by step"}
      ]
    }
  ]
}`;

  try {
    const { content } = await chat(prompt, []);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as CEOAnalysis;
    }
  } catch { /* fall through to heuristic */ }

  // Fallback: heuristic analysis
  if (isEmpty) {
    return {
      tab: tabKey,
      status: 'empty',
      observations: [`${tabLabel} tab is empty — no data yet.`],
      recommendations: [{
        action: `Populate ${tabLabel} with relevant data based on the company's services and goals.`,
        department: 'coo',
        priority: 'medium',
        suggestedTasks: [{
          title: `Research and populate ${tabLabel} tab`,
          assignee: 'SAGE',
          description: `Analyze what ${tabLabel} should contain based on company services. Create relevant entries.`,
        }],
      }],
    };
  }

  return {
    tab: tabKey,
    status: 'healthy',
    observations: [`${tabLabel} tab has data and appears healthy.`],
    recommendations: [],
  };
}

/**
 * CEO runs a full sweep of all tabs, generates tasks for empty/stale ones.
 * Returns the total tasks created.
 */
export async function ceoSweep(): Promise<{ tabsAnalyzed: number; tasksCreated: number; findings: CEOAnalysis[] }> {
  const findings: CEOAnalysis[] = [];
  let tasksCreated = 0;

  // Gather data from key tabs
  const tabsToCheck = [
    { key: 'tasks', label: 'Tasks', getData: async () => {
      const count = await db.task.count();
      const pending = await db.task.count({ where: { status: 'pending' } });
      return { count, pending, isEmpty: count === 0 };
    }},
    { key: 'crm', label: 'CRM & Sales', getData: async () => {
      const clients = await db.client.count().catch(() => 0);
      const leads = await db.lead.count().catch(() => 0);
      const tickets = await db.supportTicket.count().catch(() => 0);
      return { clients, leads, tickets, isEmpty: clients === 0 && leads === 0 };
    }},
    { key: 'payments', label: 'Payments', getData: async () => {
      const payments = await db.payment.count();
      const confirmed = await db.payment.count({ where: { status: 'confirmed' } });
      return { payments, confirmed, isEmpty: payments === 0 };
    }},
    { key: 'earning-methods', label: 'Earning Methods', getData: async () => {
      const methods = await db.earningMethod.count().catch(() => 0);
      const approved = await db.earningMethod.count({ where: { approved: true } }).catch(() => 0);
      return { methods, approved, isEmpty: methods === 0 };
    }},
    { key: 'memory', label: 'Memory Store', getData: async () => {
      const items = await db.memoryItem.count();
      const pinned = await db.memoryItem.count({ where: { pinned: true } });
      return { items, pinned, isEmpty: items === 0 };
    }},
    { key: 'skills', label: 'Skills', getData: async () => {
      const skills = await db.skill.count();
      const enabled = await db.skill.count({ where: { enabled: true } });
      return { skills, enabled, isEmpty: skills === 0 };
    }},
  ];

  for (const tab of tabsToCheck) {
    try {
      const data = await tab.getData();
      const analysis = await analyzeTab(tab.key, tab.label, data);
      findings.push(analysis);

      // Create tasks from recommendations
      for (const rec of analysis.recommendations) {
        for (const taskSuggestion of rec.suggestedTasks) {
          // Check if a similar task already exists (avoid duplicates)
          const existing = await db.task.findFirst({
            where: { title: { contains: taskSuggestion.title.slice(0, 50) } },
          });
          if (!existing) {
            // Find the agent by codename
            const agent = await db.agent.findFirst({
              where: { codename: taskSuggestion.assignee.toUpperCase() },
            });
            await db.task.create({
              data: {
                title: taskSuggestion.title.slice(0, 200),
                description: taskSuggestion.description.slice(0, 2000),
                priority: rec.priority,
                assigneeId: agent?.id || null,
                tags: JSON.stringify(['ceo-auto', rec.department, tab.key]),
              },
            });
            tasksCreated++;
          }
        }
      }

      // Create a notification if action is needed
      if (analysis.status === 'empty' || analysis.status === 'action-needed') {
        await db.notification.create({
          data: {
            type: analysis.status === 'empty' ? 'warn' : 'info',
            title: `CEO: ${tab.label} tab needs attention`,
            message: analysis.observations.join(' '),
          },
        }).catch(() => {});
      }
    } catch (e) {
      // Best-effort: don't crash the sweep on one tab failure
    }
  }

  return { tabsAnalyzed: tabsToCheck.length, tasksCreated, findings };
}

/**
 * Earning method research pipeline:
 * 1. Take an earning method idea.
 * 2. Research it (web search for market demand, competition, pricing).
 * 3. Simulate the process (step-by-step from idea to payment).
 * 4. Create tasks for each step.
 * 5. Generate lead-gen tasks once the process is ready.
 */
export async function researchEarningMethod(methodName: string, methodDescription: string): Promise<{
  research: string;
  steps: Array<{ step: number; title: string; description: string; assignee: string; department: Department }>;
  leadGenTasks: Array<{ title: string; description: string; assignee: string }>;
  tasksCreated: number;
}> {
  const prompt = `You are the CEO of an autonomous AI company. Research and design a complete step-by-step process for this earning method.

EARNING METHOD: ${methodName}
DESCRIPTION: ${methodDescription}

Your task:
1. Research market demand, competition, and pricing for this service.
2. Design a step-by-step process from idea to first payment.
3. For each step, specify which department (cto/cmo/coo/cfo) and which agent should handle it.
4. Design lead generation tasks to find clients for this service.

Available agents by department:
- CTO (Engineering): ${DEPARTMENT_AGENTS.cto.join(', ')}
- CMO (Marketing): ${DEPARTMENT_AGENTS.cmo.join(', ')}
- COO (Operations): ${DEPARTMENT_AGENTS.coo.join(', ')}
- CFO (Finance): ${DEPARTMENT_AGENTS.cfo.join(', ')}

Respond in JSON only:
{
  "research": "brief market analysis (demand, competition, pricing, timeline)",
  "steps": [
    {"step": 1, "title": "step title", "description": "detailed what to do", "assignee": "AGENT_CODENAME", "department": "cto|cmo|coo|cfo"}
  ],
  "leadGenTasks": [
    {"title": "task title", "description": "how to find clients for this", "assignee": "AGENT_CODENAME"}
  ]
}`;

  try {
    const { content } = await chat(prompt, []);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]) as {
        research: string;
        steps: Array<{ step: number; title: string; description: string; assignee: string; department: Department }>;
        leadGenTasks: Array<{ title: string; description: string; assignee: string }>;
      };

      // Create tasks for each step
      let tasksCreated = 0;
      for (const step of result.steps) {
        const agent = await db.agent.findFirst({
          where: { codename: step.assignee.toUpperCase() },
        });
        await db.task.create({
          data: {
            title: `[${methodName}] Step ${step.step}: ${step.title}`,
            description: step.description.slice(0, 2000),
            priority: 'high',
            assigneeId: agent?.id || null,
            tags: JSON.stringify(['earning-method', methodName.slice(0, 30), step.department]),
          },
        });
        tasksCreated++;
      }

      // Create lead gen tasks
      for (const leadTask of result.leadGenTasks) {
        const agent = await db.agent.findFirst({
          where: { codename: leadTask.assignee.toUpperCase() },
        });
        await db.task.create({
          data: {
            title: `[${methodName}] Lead Gen: ${leadTask.title}`,
            description: leadTask.description.slice(0, 2000),
            priority: 'medium',
            assigneeId: agent?.id || null,
            tags: JSON.stringify(['lead-gen', methodName.slice(0, 30)]),
          },
        });
        tasksCreated++;
      }

      // Store the research in memory
      await db.memoryItem.create({
        data: {
          scope: 'semantic',
          key: `earning-research-${methodName.slice(0, 30)}`,
          value: result.research.slice(0, 5000),
          tags: JSON.stringify(['earning-method', 'research', 'ceo']),
          pinned: true,
        },
      }).catch(() => {});

      // Notify
      await db.notification.create({
        data: {
          type: 'success',
          title: `CEO: Earning method "${methodName}" researched`,
          message: `${result.steps.length} steps + ${result.leadGenTasks.length} lead-gen tasks created. Research saved to memory.`,
        },
      }).catch(() => {});

      return { ...result, tasksCreated };
    }
  } catch (e) {
    // Fall through to error
  }

  return {
    research: `Research failed for ${methodName}. Please try again.`,
    steps: [],
    leadGenTasks: [],
    tasksCreated: 0,
  };
}

/**
 * CEO classifies a task into the correct department.
 * Ported from jarvis zip's ceoClassify function.
 */
export async function ceoClassify(taskDescription: string): Promise<{ department: Department; reason: string; confidence: number }> {
  const lower = taskDescription.toLowerCase();
  if (/code|function|debug|test|api|script|build|deploy|file|terminal/.test(lower)) {
    return { department: 'cto', reason: 'Engineering-related keywords', confidence: 0.8 };
  }
  if (/market|post|social|brand|seo|ad|campaign|content/.test(lower)) {
    return { department: 'cmo', reason: 'Marketing keywords', confidence: 0.8 };
  }
  if (/invoice|payment|finance|budget|expense|tax|revenue|earning/.test(lower)) {
    return { department: 'cfo', reason: 'Finance keywords', confidence: 0.8 };
  }
  return { department: 'coo', reason: 'Default to operations', confidence: 0.5 };
}

/**
 * Full earning method deployment pipeline:
 * 1. Research the method (market demand, competition).
 * 2. Simulate the process (cost, timeline, sample deliverable).
 * 3. Prepare workflow steps.
 * 4. Request owner approval with summary.
 * 5. Answer owner questions.
 * 6. Deploy (create tasks) only after approval.
 *
 * This is the autonomous earning pipeline — no human intervention until the approval checkpoint.
 */
export async function deployEarningMethodPipeline(methodId: string): Promise<{
  status: string;
  message: string;
  simulation?: unknown;
  workflowSteps?: string[];
}> {
  const method = await db.earningMethod.findUnique({ where: { id: methodId } });
  if (!method) {
    return { status: 'error', message: 'Earning method not found' };
  }

  // Step 1: Update status to researching
  await db.earningMethod.update({
    where: { id: methodId },
    data: { approvalStatus: 'researching', lastResearched: new Date() },
  });

  // Step 2: Run simulation (calls the simulate API logic inline)
  const simulationPrompt = `You are the CEO running a simulation for: ${method.name} — ${method.description}

Run a thorough simulation:
1. Market test: Who buys this? Demand? Price range?
2. Cost analysis: Resources/agents/tools needed? Cost per delivery?
3. Timeline: Start to first payment? Per delivery?
4. Sample deliverable: Create a sample output.
5. Risk assessment: What could go wrong? Mitigations?
6. Workflow steps: Step-by-step from client inquiry to payment.

Respond in JSON: {"marketTest":"","costAnalysis":"","timeline":"","sampleDeliverable":"","riskAssessment":"","workflowSteps":["step1","step2",...]}`;

  const { content: simContent } = await chat(simulationPrompt, []);
  let simulation;
  let workflowSteps: string[] = [];
  try {
    const match = simContent.match(/\{[\s\S]*\}/);
    if (match) {
      simulation = JSON.parse(match[0]);
      workflowSteps = simulation.workflowSteps || [];
    }
  } catch {
    simulation = { raw: simContent };
  }

  // Save simulation results
  await db.earningMethod.update({
    where: { id: methodId },
    data: {
      simulationResults: JSON.stringify(simulation).slice(0, 10000),
      workflowSteps: JSON.stringify(workflowSteps).slice(0, 5000),
      approvalStatus: 'ready',
    },
  });

  // Step 3: Request approval from owner
  const summaryPrompt = `You are the CEO presenting "${method.name}" for owner approval.

Simulation results: ${JSON.stringify(simulation).slice(0, 2000)}

Write a concise summary (under 200 words) explaining what this method is, expected earnings, risks, and what's needed. End with "Awaiting your approval to deploy."`;

  const { content: summary } = await chat(summaryPrompt, []);

  await db.earningMethod.update({
    where: { id: methodId },
    data: { approvalStatus: 'pending_approval' },
  });

  // Create approval notification
  await db.notification.create({
    data: {
      type: 'warn',
      title: `🔔 Approval Required: ${method.name}`,
      message: `${summary.slice(0, 400)}\n\nSimulation complete. ${workflowSteps.length} workflow steps ready. Review and approve to deploy.`,
    },
  });

  // Store the summary in memory for Q&A
  await db.memoryItem.create({
    data: {
      scope: 'semantic',
      key: `earning-approval-${methodId}`,
      value: summary,
      tags: JSON.stringify(['earning-method', 'approval', method.key]),
      pinned: true,
    },
  }).catch(() => {});

  return {
    status: 'pending_approval',
    message: `Simulation complete. ${workflowSteps.length} workflow steps ready. Owner approval requested.`,
    simulation,
    workflowSteps,
  };
}
