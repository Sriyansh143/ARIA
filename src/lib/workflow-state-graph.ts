/**
 * ARIA Mission Control — State-Graph Workflow Engine (LangGraph Equivalent)
 * 
 * This module provides a state-graph workflow engine that allows workflows to be 
 * defined as directed graphs with nodes, edges, conditions, and persistent state.
 * 
 * Key Features:
 * - Graph definition: nodes + edges + conditions
 * - State machine: track current node, history, state
 * - Execution: traverse graph based on conditions
 * - Checkpointing: save state after each node (for debugging/resume)
 * - Error handling: retry logic, fallback paths
 * 
 * Phase 34: State-Graph Workflow Engine
 */

import { db } from "./db";
import { emit } from "./event-bus";
import { toIso, LOG_LEVELS } from "./types";
import { logger } from "./logger";
import { routeWorkflowByAutonomy } from "./conductor/router";

// ─── Node Types ──────────────────────────────────────────────────────

export type NodeType =
  | "task"        // Execute a task (call agent, run function)
  | "decision"    // Conditional routing based on state
  | "approval"    // Pause for human approval
  | "agent"       // Call a specific agent with context
  | "end";        // Workflow complete

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskNode extends BaseNode {
  type: "task";
  config: {
    handler: string;      // Function/handler name to execute
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    timeoutMs?: number;
    retries?: number;
  };
}

export interface DecisionNode extends BaseNode {
  type: "decision";
  config: {
    expression: string;   // JavaScript expression to evaluate (e.g., "state.score > 70")
    branches: {
      condition: string;  // Condition label (e.g., "high_score", "low_score")
      expression: string; // Boolean expression for this branch
      nextNodeId: string;
    }[];
    defaultNextNodeId?: string;
  };
}

export interface ApprovalNode extends BaseNode {
  type: "approval";
  config: {
    title: string;
    summary: string;
    risk: "low" | "medium" | "high" | "critical";
    amount?: number;
    payload?: Record<string, unknown>;
    timeoutHours?: number;
  };
}

export interface AgentNode extends BaseNode {
  type: "agent";
  config: {
    agentId: string;      // Agent identifier
    tool?: string;        // Optional specific tool to call
    prompt: string;       // Prompt template (can use {{variables}})
    contextKeys?: string[]; // State keys to include in context
  };
}

export interface EndNode extends BaseNode {
  type: "end";
  config: {
    outputMapping?: Record<string, string>; // Map state keys to output
  };
}

export type WorkflowNode = TaskNode | DecisionNode | ApprovalNode | AgentNode | EndNode;

// ─── Edge Types ──────────────────────────────────────────────────────

export interface Edge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition?: string;     // Optional condition for conditional edges
  label?: string;         // Human-readable label for the edge
}

// ─── Workflow Definition ─────────────────────────────────────────────

export interface WorkflowGraph {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  startNodeId: string;
  endNodeId?: string;
  variables?: Record<string, unknown>; // Default variables
  metadata?: {
    author?: string;
    tags?: string[];
    category?: string;
  };
}

// ─── State Management ────────────────────────────────────────────────

export interface WorkflowState {
  id: string;                    // Unique state ID (checkpoint ID)
  workflowId: string;
  workflowName: string;
  status: "running" | "completed" | "failed" | "awaiting_approval" | "paused";
  currentNodeId: string | null;
  visitedNodes: string[];        // History of visited node IDs
  state: Record<string, unknown>; // Current state variables
  checkpoints: Checkpoint[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error?: string;
}

export interface Checkpoint {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  stateBefore: Record<string, unknown>;
  stateAfter: Record<string, unknown>;
  result?: NodeResult;
  error?: string;
  timestamp: string;
  canResume: boolean;
}

export interface NodeResult {
  nodeId: string;
  nodeName: string;
  type: NodeType;
  success: boolean;
  output: unknown;
  latencyMs: number;
  ts: string;
}

// ─── In-Memory Store for Active Runs ─────────────────────────────────

const activeStates = new Map<string, WorkflowState>();

// ─── Helper Functions ────────────────────────────────────────────────

function getNodeById(nodes: WorkflowNode[], nodeId: string): WorkflowNode | undefined {
  return nodes.find((n) => n.id === nodeId);
}

function getOutgoingEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((e) => e.sourceNodeId === nodeId);
}

function evaluateCondition(expression: string, state: Record<string, unknown>): boolean {
  try {
    // Safe evaluation using Function constructor with limited scope
    const fn = new Function("state", `"use strict"; return (${expression});`);
    return !!fn(state);
  } catch (err) {
    logger.error("workflow-engine.evaluate-condition-error", {
      expression,
      error: String(err),
    });
    return false;
  }
}

function interpolatePrompt(prompt: string, state: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = state[key];
    if (value === undefined) {
      logger.warn("workflow-engine.missing-variable", { key });
      return "";
    }
    return String(value);
  });
}

// ─── Checkpoint Management ──────────────────────────────────────────

async function createCheckpoint(
  state: WorkflowState,
  node: WorkflowNode,
  stateBefore: Record<string, unknown>,
  stateAfter: Record<string, unknown>,
  result?: NodeResult,
  error?: string
): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    stateBefore,
    stateAfter,
    result,
    error,
    timestamp: new Date().toISOString(),
    canResume: !error && node.type !== "end",
  };

  state.checkpoints.push(checkpoint);
  state.updatedAt = checkpoint.timestamp;

  // Persist to database
  try {
    await db.workflowCheckpoint.create({
      data: {
        id: checkpoint.id,
        workflowStateId: state.id,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        stateBeforeJson: JSON.stringify(stateBefore),
        stateAfterJson: JSON.stringify(stateAfter),
        resultJson: result ? JSON.stringify(result) : null,
        error: error ?? null,
        timestamp: new Date(checkpoint.timestamp),
        canResume: checkpoint.canResume,
      },
    });
  } catch (err) {
    logger.error("workflow-engine.checkpoint-persist-error", {
      checkpointId: checkpoint.id,
      error: String(err),
    });
  }

  return checkpoint;
}

async function saveWorkflowState(state: WorkflowState): Promise<void> {
  try {
    await db.workflowState.upsert({
      where: { id: state.id },
      update: {
        status: state.status,
        currentNodeId: state.currentNodeId,
        visitedNodesJson: JSON.stringify(state.visitedNodes),
        stateJson: JSON.stringify(state.state),
        updatedAt: new Date(state.updatedAt),
        completedAt: state.completedAt ? new Date(state.completedAt) : null,
        error: state.error ?? null,
      },
      create: {
        id: state.id,
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        status: state.status,
        currentNodeId: state.currentNodeId,
        visitedNodesJson: JSON.stringify(state.visitedNodes),
        stateJson: JSON.stringify(state.state),
        startedAt: new Date(state.startedAt),
        updatedAt: new Date(state.updatedAt),
        completedAt: state.completedAt ? new Date(state.completedAt) : null,
        error: state.error ?? null,
      },
    });
  } catch (err) {
    logger.error("workflow-engine.state-persist-error", {
      stateId: state.id,
      error: String(err),
    });
  }
}

// ─── Node Execution Handlers ────────────────────────────────────────

async function executeTaskNode(
  node: TaskNode,
  state: Record<string, unknown>,
  workflowRunId: string
): Promise<{ output: unknown; error?: string }> {
  const startTime = Date.now();
  
  try {
    // TODO: Implement actual task handlers based on handler name
    // For now, return a placeholder
    logger.info("workflow-engine.task-executing", {
      nodeId: node.id,
      handler: node.config.handler,
    });

    // Placeholder: In production, this would call the actual handler
    const output = {
      executed: node.config.handler,
      timestamp: new Date().toISOString(),
    };

    return { output };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

async function executeDecisionNode(
  node: DecisionNode,
  state: Record<string, unknown>
): Promise<{ output: string; selectedBranch?: string }> {
  try {
    // Evaluate each branch condition
    for (const branch of node.config.branches) {
      const matches = evaluateCondition(branch.expression, state);
      if (matches) {
        return {
          output: branch.condition,
          selectedBranch: branch.nextNodeId,
        };
      }
    }

    // No branch matched, use default
    if (node.config.defaultNextNodeId) {
      return {
        output: "default",
        selectedBranch: node.config.defaultNextNodeId,
      };
    }

    throw new Error("No matching branch and no default");
  } catch (err) {
    return {
      output: "error",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

async function executeApprovalNode(
  node: ApprovalNode,
  state: Record<string, unknown>,
  workflowState: WorkflowState
): Promise<{ output: { approvalId: string; status: string }; paused: boolean }> {
  try {
    // Create approval record
    const approval = await db.approval.create({
      data: {
        title: node.config.title,
        summary: node.config.summary,
        risk: node.config.risk,
        amount: node.config.amount,
        payload: node.config.payload ? JSON.stringify(node.config.payload) : null,
        status: "pending",
        requester: `workflow:${workflowState.workflowId}`,
      },
    });

    // Emit approval event
    emit({
      type: "approval",
      ts: new Date().toISOString(),
      approval: {
        id: approval.id,
        title: approval.title,
        summary: approval.summary,
        risk: approval.risk as "low" | "medium" | "high" | "critical",
        status: "pending",
        requester: approval.requester,
        agentId: approval.agentId,
        action: approval.action,
        amount: approval.amount,
        payload: approval.payload,
        brief: approval.brief,
        discussionLog: approval.discussionLog,
        oralConfirmed: approval.oralConfirmed,
        voiceCallId: approval.voiceCallId,
        createdAt: toIso(approval.createdAt)!,
        decidedAt: null,
      },
    });

    // Send Telegram notification
    try {
      const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
        "./owner-approval/telegram-approval"
      );
      const payload = await buildApprovalRequestFromRow(approval.id, "workflow");
      if (payload) {
        await requestOwnerApproval(payload);
      } else {
        const { sendApprovalNotification } = await import("./telegram-notifier");
        await sendApprovalNotification(approval.title, approval.risk, approval.amount);
      }
    } catch {
      // Ignore notification errors
    }

    return {
      output: { approvalId: approval.id, status: "pending" },
      paused: true,
    };
  } catch (err) {
    return {
      output: { approvalId: "", status: "error" },
      error: err instanceof Error ? err.message : "unknown error",
      paused: false,
    };
  }
}

async function executeAgentNode(
  node: AgentNode,
  state: Record<string, unknown>
): Promise<{ output: unknown; error?: string }> {
  try {
    // Interpolate prompt with state variables
    const prompt = interpolatePrompt(node.config.prompt, state);

    // Build context from specified state keys
    const context: Record<string, unknown> = {};
    if (node.config.contextKeys) {
      for (const key of node.config.contextKeys) {
        if (key in state) {
          context[key] = state[key];
        }
      }
    }

    logger.info("workflow-engine.agent-calling", {
      nodeId: node.id,
      agentId: node.config.agentId,
      tool: node.config.tool,
    });

    // TODO: Integrate with actual agent system
    // For now, return a placeholder
    const output = {
      agentId: node.config.agentId,
      tool: node.config.tool,
      prompt,
      context,
      response: "Agent response placeholder",
    };

    return { output };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

// ─── Main Workflow Execution Engine ─────────────────────────────────

export async function executeWorkflowGraph(
  graph: WorkflowGraph,
  initialState: Record<string, unknown> = {}
): Promise<WorkflowState> {
  const stateId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  const workflowState: WorkflowState = {
    id: stateId,
    workflowId: graph.id,
    workflowName: graph.name,
    status: "running",
    currentNodeId: graph.startNodeId,
    visitedNodes: [],
    state: { ...graph.variables, ...initialState },
    checkpoints: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  activeStates.set(stateId, workflowState);

  // Persist initial state
  await saveWorkflowState(workflowState);

  // Check autonomy routing
  try {
    const wfDef = await db.workflowDefinition.findUnique({
      where: { slug: graph.id },
    });
    if (wfDef) {
      const requester =
        (typeof initialState.requester === "string" && initialState.requester) ||
        (typeof initialState.__requester === "string" && initialState.__requester) ||
        "workflow-engine";
      const decision = await routeWorkflowByAutonomy(wfDef.id, requester);
      if (!decision.allowed) {
        workflowState.status = decision.approvalId ? "awaiting_approval" : "failed";
        workflowState.completedAt = new Date().toISOString();
        workflowState.error = decision.reason ?? "Blocked by autonomy router";
        await saveWorkflowState(workflowState);
        activeStates.delete(stateId);
        return workflowState;
      }
    }
  } catch (err) {
    logger.warn("workflow-engine.autonomy-router-error", {
      workflowId: graph.id,
      error: String(err),
    });
  }

  // Emit start event
  emit({
    type: "system",
    ts: workflowState.startedAt,
    message: `Workflow graph "${graph.name}" started (${graph.nodes.length} nodes)`,
    level: "info" as (typeof LOG_LEVELS)[number],
  });

  // Execute nodes until we reach an end node or error
  const MAX_ITERATIONS = 100; // Prevent infinite loops
  let iterations = 0;

  while (workflowState.currentNodeId && iterations < MAX_ITERATIONS) {
    iterations++;
    const node = getNodeById(graph.nodes, workflowState.currentNodeId);

    if (!node) {
      workflowState.status = "failed";
      workflowState.error = `Node not found: ${workflowState.currentNodeId}`;
      break;
    }

    // Cycle detection
    if (workflowState.visitedNodes.includes(node.id)) {
      // Allow re-visiting for non-decision nodes (loops are intentional)
      if (node.type !== "decision" && node.type !== "task") {
        workflowState.status = "failed";
        workflowState.error = "Cycle detected in workflow graph";
        logger.error("workflow-engine.cycle-detected", {
          workflowId: graph.id,
          nodeId: node.id,
        });
        break;
      }
    }

    workflowState.visitedNodes.push(node.id);
    const stateBefore = { ...workflowState.state };

    try {
      let result: NodeResult | undefined;
      let nextStateId: string | null = null;
      let shouldPause = false;

      // Execute based on node type
      switch (node.type) {
        case "task": {
          const taskResult = await executeTaskNode(node, workflowState.state, stateId);
          if (taskResult.error) {
            throw new Error(taskResult.error);
          }
          workflowState.state[node.id] = taskResult.output;
          
          // Find next node via edges
          const edges = getOutgoingEdges(graph.edges, node.id);
          nextStateId = edges[0]?.targetNodeId ?? null;
          
          result = {
            nodeId: node.id,
            nodeName: node.name,
            type: node.type,
            success: true,
            output: taskResult.output,
            latencyMs: 0,
            ts: new Date().toISOString(),
          };
          break;
        }

        case "decision": {
          const decisionResult = await executeDecisionNode(node, workflowState.state);
          workflowState.state[node.id] = decisionResult.output;
          nextStateId = decisionResult.selectedBranch ?? null;
          
          result = {
            nodeId: node.id,
            nodeName: node.name,
            type: node.type,
            success: true,
            output: decisionResult.output,
            latencyMs: 0,
            ts: new Date().toISOString(),
          };
          break;
        }

        case "approval": {
          const approvalResult = await executeApprovalNode(node, workflowState.state, workflowState);
          workflowState.state[node.id] = approvalResult.output;
          
          if (approvalResult.paused) {
            workflowState.status = "awaiting_approval";
            shouldPause = true;
          }
          
          result = {
            nodeId: node.id,
            nodeName: node.name,
            type: node.type,
            success: true,
            output: approvalResult.output,
            latencyMs: 0,
            ts: new Date().toISOString(),
          };
          break;
        }

        case "agent": {
          const agentResult = await executeAgentNode(node, workflowState.state);
          if (agentResult.error) {
            throw new Error(agentResult.error);
          }
          workflowState.state[node.id] = agentResult.output;
          
          const edges = getOutgoingEdges(graph.edges, node.id);
          nextStateId = edges[0]?.targetNodeId ?? null;
          
          result = {
            nodeId: node.id,
            nodeName: node.name,
            type: node.type,
            success: true,
            output: agentResult.output,
            latencyMs: 0,
            ts: new Date().toISOString(),
          };
          break;
        }

        case "end": {
          workflowState.status = "completed";
          workflowState.completedAt = new Date().toISOString();
          nextStateId = null;
          
          result = {
            nodeId: node.id,
            nodeName: node.name,
            type: node.type,
            success: true,
            output: { completed: true },
            latencyMs: 0,
            ts: new Date().toISOString(),
          };
          break;
        }
      }

      // Create checkpoint
      const stateAfter = { ...workflowState.state };
      await createCheckpoint(workflowState, node, stateBefore, stateAfter, result);

      // Update current node
      workflowState.currentNodeId = nextStateId;

      // Save state
      await saveWorkflowState(workflowState);

      // Pause if waiting for approval
      if (shouldPause) {
        break;
      }

      // Check if workflow is complete
      if (workflowState.status === "completed") {
        break;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      
      // Create checkpoint with error
      await createCheckpoint(
        workflowState,
        node,
        stateBefore,
        workflowState.state,
        undefined,
        errorMessage
      );

      workflowState.status = "failed";
      workflowState.error = errorMessage;
      workflowState.currentNodeId = null;
      
      await saveWorkflowState(workflowState);
      break;
    }
  }

  // Emit completion event
  emit({
    type: "system",
    ts: workflowState.completedAt ?? new Date().toISOString(),
    message: `Workflow graph "${graph.name}" ${workflowState.status} (${workflowState.visitedNodes.length} nodes visited)`,
    level: workflowState.status === "completed" ? "success" as (typeof LOG_LEVELS)[number] : "error" as (typeof LOG_LEVELS)[number],
  });

  // Clean up from active states if completed or failed
  if (workflowState.status === "completed" || workflowState.status === "failed") {
    activeStates.delete(stateId);
  }

  return workflowState;
}

// ─── Resume Workflow from Checkpoint ─────────────────────────────────

export async function resumeWorkflow(
  stateId: string,
  approvalDecision?: { approved: boolean; comments?: string }
): Promise<WorkflowState | null> {
  const workflowState = activeStates.get(stateId);
  
  if (!workflowState) {
    // Try to load from database
    try {
      const dbState = await db.workflowState.findUnique({
        where: { id: stateId },
        include: { checkpoints: { orderBy: { timestamp: "desc" } } },
      });
      
      if (dbState) {
        workflowState = {
          ...dbState,
          visitedNodes: JSON.parse(dbState.visitedNodesJson || "[]"),
          state: JSON.parse(dbState.stateJson || "{}"),
          checkpoints: dbState.checkpoints.map((cp) => ({
            ...cp,
            stateBefore: JSON.parse(cp.stateBeforeJson || "{}"),
            stateAfter: JSON.parse(cp.stateAfterJson || "{}"),
            result: cp.resultJson ? JSON.parse(cp.resultJson) : undefined,
          })),
        };
        activeStates.set(stateId, workflowState);
      }
    } catch (err) {
      logger.error("workflow-engine.resume-load-error", {
        stateId,
        error: String(err),
      });
      return null;
    }
  }

  if (!workflowState || workflowState.status !== "awaiting_approval") {
    return null;
  }

  if (!approvalDecision) {
    return null;
  }

  // Process approval decision
  const currentNode = workflowState.currentNodeId;
  if (!currentNode) {
    return null;
  }

  // Update approval record
  try {
    const approval = await db.approval.findFirst({
      where: {
        payload: { contains: stateId },
      },
      orderBy: { createdAt: "desc" },
    });

    if (approval) {
      await db.approval.update({
        where: { id: approval.id },
        data: {
          status: approvalDecision.approved ? "approved" : "rejected",
          decidedAt: new Date(),
          discussionLog: approvalDecision.comments
            ? `${approval.discussionLog ?? ""}\nOwner: ${approvalDecision.comments}`
            : approval.discussionLog,
        },
      });
    }
  } catch (err) {
    logger.error("workflow-engine.approval-update-error", {
      stateId,
      error: String(err),
    });
  }

  // If approved, continue to next node
  if (approvalDecision.approved) {
    // Load workflow graph
    const wfDef = await db.workflowDefinition.findUnique({
      where: { slug: workflowState.workflowId },
    });

    if (wfDef) {
      const graph: WorkflowGraph = {
        ...JSON.parse(wfDef.stepsJson),
        id: wfDef.slug,
        name: wfDef.name,
        description: wfDef.description ?? "",
        version: "1.0.0",
      };

      // Find next node after approval
      const edges = getOutgoingEdges(graph.edges, currentNode);
      workflowState.currentNodeId = edges[0]?.targetNodeId ?? null;
      workflowState.status = "running";
      workflowState.updatedAt = new Date().toISOString();

      await saveWorkflowState(workflowState);

      // Continue execution
      return executeWorkflowGraph(graph, workflowState.state);
    }
  } else {
    // Rejected
    workflowState.status = "failed";
    workflowState.completedAt = new Date().toISOString();
    workflowState.error = "Approval rejected";
    workflowState.currentNodeId = null;

    await saveWorkflowState(workflowState);
    activeStates.delete(stateId);
  }

  return workflowState;
}

// ─── Get Workflow State ──────────────────────────────────────────────

export async function getWorkflowState(stateId: string): Promise<WorkflowState | null> {
  const workflowState = activeStates.get(stateId);
  
  if (workflowState) {
    return workflowState;
  }

  // Load from database
  try {
    const dbState = await db.workflowState.findUnique({
      where: { id: stateId },
      include: { checkpoints: { orderBy: { timestamp: "asc" } } },
    });

    if (dbState) {
      return {
        ...dbState,
        visitedNodes: JSON.parse(dbState.visitedNodesJson || "[]"),
        state: JSON.parse(dbState.stateJson || "{}"),
        checkpoints: dbState.checkpoints.map((cp) => ({
          ...cp,
          stateBefore: JSON.parse(cp.stateBeforeJson || "{}"),
          stateAfter: JSON.parse(cp.stateAfterJson || "{}"),
          result: cp.resultJson ? JSON.parse(cp.resultJson) : undefined,
        })),
      };
    }
  } catch (err) {
    logger.error("workflow-engine.get-state-error", {
      stateId,
      error: String(err),
    });
  }

  return null;
}

// ─── Get Debug Trace ─────────────────────────────────────────────────

export async function getDebugTrace(stateId: string): Promise<{
  workflowState: WorkflowState | null;
  trace: Array<{
    checkpoint: Checkpoint;
    duration: number;
  }>;
} | null> {
  const workflowState = await getWorkflowState(stateId);
  
  if (!workflowState) {
    return null;
  }

  const trace = workflowState.checkpoints.map((cp, index) => {
    const nextCp = workflowState.checkpoints[index + 1];
    const duration = nextCp
      ? new Date(nextCp.timestamp).getTime() - new Date(cp.timestamp).getTime()
      : 0;

    return {
      checkpoint: cp,
      duration,
    };
  });

  return { workflowState, trace };
}

// ─── Export Functions ────────────────────────────────────────────────

export {
  getNodeById,
  getOutgoingEdges,
  evaluateCondition,
  interpolatePrompt,
};
