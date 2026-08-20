/**
 * Phase 34: State-Graph Workflow Engine Tests
 * 
 * Tests for the LangGraph-equivalent state-graph workflow engine.
 * Covers: graph traversal, state management, checkpointing, approval integration
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  executeWorkflowGraph,
  resumeWorkflow,
  getWorkflowState,
  getDebugTrace,
  type WorkflowGraph,
  type WorkflowNode,
  type Edge,
} from "@/lib/workflow-state-graph";

describe("Workflow State Graph Engine", () => {
  // Sample workflow graphs for testing
  
  const simpleLinearGraph: WorkflowGraph = {
    id: "test-linear-workflow",
    name: "Simple Linear Workflow",
    description: "A simple linear workflow with task nodes",
    version: "1.0.0",
    startNodeId: "node1",
    nodes: [
      {
        id: "node1",
        type: "task",
        name: "First Task",
        config: { handler: "test-handler-1" },
      },
      {
        id: "node2",
        type: "task",
        name: "Second Task",
        config: { handler: "test-handler-2" },
      },
      {
        id: "node3",
        type: "end",
        name: "End",
        config: {},
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "node1", targetNodeId: "node2" },
      { id: "e2", sourceNodeId: "node2", targetNodeId: "node3" },
    ],
  };

  const decisionGraph: WorkflowGraph = {
    id: "test-decision-workflow",
    name: "Decision Workflow",
    description: "Workflow with conditional branching",
    version: "1.0.0",
    startNodeId: "decision-node",
    nodes: [
      {
        id: "decision-node",
        type: "decision",
        name: "Score Check",
        config: {
          expression: "state.score > 70",
          branches: [
            { condition: "high_score", expression: "state.score > 70", nextNodeId: "high-path" },
            { condition: "low_score", expression: "state.score <= 70", nextNodeId: "low-path" },
          ],
        },
      },
      {
        id: "high-path",
        type: "task",
        name: "High Score Path",
        config: { handler: "high-score-handler" },
      },
      {
        id: "low-path",
        type: "task",
        name: "Low Score Path",
        config: { handler: "low-score-handler" },
      },
      {
        id: "end-node",
        type: "end",
        name: "End",
        config: {},
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "high-path", targetNodeId: "end-node" },
      { id: "e2", sourceNodeId: "low-path", targetNodeId: "end-node" },
    ],
  };

  describe("Graph Traversal", () => {
    it("should execute linear workflow from start to end", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      expect(result.status).toBe("completed");
      expect(result.visitedNodes).toHaveLength(3);
      expect(result.visitedNodes[0]).toBe("node1");
      expect(result.visitedNodes[1]).toBe("node2");
      expect(result.visitedNodes[2]).toBe("node3");
      expect(result.checkpoints.length).toBeGreaterThan(0);
    });

    it("should follow high score branch when score > 70", async () => {
      const result = await executeWorkflowGraph(decisionGraph, { score: 85 });
      
      expect(result.status).toBe("completed");
      expect(result.state["decision-node"]).toBe("high_score");
      expect(result.visitedNodes).toContain("high-path");
      expect(result.visitedNodes).not.toContain("low-path");
    });

    it("should follow low score branch when score <= 70", async () => {
      const result = await executeWorkflowGraph(decisionGraph, { score: 50 });
      
      expect(result.status).toBe("completed");
      expect(result.state["decision-node"]).toBe("low_score");
      expect(result.visitedNodes).toContain("low-path");
      expect(result.visitedNodes).not.toContain("high-path");
    });
  });

  describe("State Management", () => {
    it("should initialize state with provided values", async () => {
      const initialState = { customVar: "test-value", number: 42 };
      const result = await executeWorkflowGraph(simpleLinearGraph, initialState);
      
      expect(result.state.customVar).toBe("test-value");
      expect(result.state.number).toBe(42);
    });

    it("should persist node results in state", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      expect(result.state.node1).toBeDefined();
      expect(result.state.node2).toBeDefined();
    });

    it("should track visited nodes history", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      expect(result.visitedNodes).toEqual(["node1", "node2", "node3"]);
    });
  });

  describe("Checkpointing", () => {
    it("should create checkpoint after each node execution", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      expect(result.checkpoints.length).toBe(3);
      
      // Verify checkpoint structure
      const firstCheckpoint = result.checkpoints[0];
      expect(firstCheckpoint.nodeId).toBe("node1");
      expect(firstCheckpoint.nodeType).toBe("task");
      expect(firstCheckpoint.canResume).toBe(true);
    });

    it("should capture state before and after node execution", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      const firstCheckpoint = result.checkpoints[0];
      expect(firstCheckpoint.stateBefore).toBeDefined();
      expect(firstCheckpoint.stateAfter).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle missing node gracefully", async () => {
      const invalidGraph: WorkflowGraph = {
        ...simpleLinearGraph,
        startNodeId: "nonexistent-node",
      };
      
      const result = await executeWorkflowGraph(invalidGraph);
      
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Node not found");
    });

    it("should detect cycles in workflow graph", async () => {
      const cyclicGraph: WorkflowGraph = {
        id: "cyclic-test",
        name: "Cyclic Test",
        description: "Test cycle detection",
        version: "1.0.0",
        startNodeId: "node-a",
        nodes: [
          { id: "node-a", type: "task" as const, name: "A", config: { handler: "h1" } },
          { id: "node-b", type: "task" as const, name: "B", config: { handler: "h2" } },
        ],
        edges: [
          { id: "e1", sourceNodeId: "node-a", targetNodeId: "node-b" },
          { id: "e2", sourceNodeId: "node-b", targetNodeId: "node-a" },
        ],
      };
      
      const result = await executeWorkflowGraph(cyclicGraph);
      
      // Should complete or fail due to max iterations
      expect(result.visitedNodes.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Get Workflow State", () => {
    it("should retrieve workflow state by ID", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      const retrieved = await getWorkflowState(result.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(result.id);
      expect(retrieved?.status).toBe("completed");
    });
  });

  describe("Debug Trace", () => {
    it("should return full execution trace with durations", async () => {
      const result = await executeWorkflowGraph(simpleLinearGraph);
      
      const trace = await getDebugTrace(result.id);
      
      expect(trace).not.toBeNull();
      expect(trace?.workflowState).toBeDefined();
      expect(trace?.trace.length).toBe(result.checkpoints.length);
      
      if (trace?.trace.length) {
        expect(trace.trace[0].checkpoint.nodeId).toBe("node1");
        expect(trace.trace[0].duration).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

describe("Helper Functions", () => {
  const nodes: WorkflowNode[] = [
    { id: "n1", type: "task", name: "Node 1", config: { handler: "h1" } },
    { id: "n2", type: "task", name: "Node 2", config: { handler: "h2" } },
  ];

  const edges: Edge[] = [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
    { id: "e2", sourceNodeId: "n1", targetNodeId: "n3" },
  ];

  describe("getNodeById", () => {
    it("should find node by ID", () => {
      const { getNodeById } = require("@/lib/workflow-state-graph");
      const node = getNodeById(nodes, "n1");
      
      expect(node).toBeDefined();
      expect(node?.name).toBe("Node 1");
    });

    it("should return undefined for non-existent node", () => {
      const { getNodeById } = require("@/lib/workflow-state-graph");
      const node = getNodeById(nodes, "nonexistent");
      
      expect(node).toBeUndefined();
    });
  });

  describe("getOutgoingEdges", () => {
    it("should find all outgoing edges from a node", () => {
      const { getOutgoingEdges } = require("@/lib/workflow-state-graph");
      const outgoing = getOutgoingEdges(edges, "n1");
      
      expect(outgoing.length).toBe(2);
    });

    it("should return empty array for node with no outgoing edges", () => {
      const { getOutgoingEdges } = require("@/lib/workflow-state-graph");
      const outgoing = getOutgoingEdges(edges, "n2");
      
      expect(outgoing.length).toBe(0);
    });
  });

  describe("evaluateCondition", () => {
    it("should evaluate boolean expressions correctly", () => {
      const { evaluateCondition } = require("@/lib/workflow-state-graph");
      
      expect(evaluateCondition("state.value > 50", { value: 60 })).toBe(true);
      expect(evaluateCondition("state.value > 50", { value: 40 })).toBe(false);
      expect(evaluateCondition("state.flag === true", { flag: true })).toBe(true);
    });

    it("should handle complex expressions", () => {
      const { evaluateCondition } = require("@/lib/workflow-state-graph");
      
      expect(
        evaluateCondition("state.a > 10 && state.b < 20", { a: 15, b: 10 })
      ).toBe(true);
      expect(
        evaluateCondition("state.a > 10 || state.b > 20", { a: 5, b: 25 })
      ).toBe(true);
    });

    it("should return false on error", () => {
      const { evaluateCondition } = require("@/lib/workflow-state-graph");
      
      expect(evaluateCondition("invalid syntax {{", {})).toBe(false);
    });
  });

  describe("interpolatePrompt", () => {
    it("should replace variables in prompt template", () => {
      const { interpolatePrompt } = require("@/lib/workflow-state-graph");
      
      const prompt = "Hello {{name}}, your score is {{score}}";
      const result = interpolatePrompt(prompt, { name: "Alice", score: 95 });
      
      expect(result).toBe("Hello Alice, your score is 95");
    });

    it("should handle missing variables gracefully", () => {
      const { interpolatePrompt } = require("@/lib/workflow-state-graph");
      
      const prompt = "Hello {{name}}, welcome!";
      const result = interpolatePrompt(prompt, {});
      
      expect(result).toBe("Hello , welcome!");
    });
  });
});
