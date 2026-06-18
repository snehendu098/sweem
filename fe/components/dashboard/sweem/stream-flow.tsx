"use client";

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// React-Flow node graph for the claim card: the org pool streams USDC to the
// employee, who can route it onward to their wallet or vault. Static (non-
// interactive) — it's a visualization, not an editor.
export function StreamFlow({
  orgName,
  poolShort,
  live,
  status,
}: {
  orgName: string;
  poolShort: string;
  live: boolean;
  status: string;
}) {
  const baseStyle: React.CSSProperties = {
    width: 150,
    borderRadius: 14,
    border: "1px solid rgba(2,79,166,0.28)",
    background: "rgba(255,255,255,0.9)",
    color: "#1a2430",
    fontSize: 12,
    fontWeight: 600,
    padding: "10px 12px",
    boxShadow: "0 4px 14px rgba(2,79,166,0.1)",
    textAlign: "center",
  };

  const nodes: Node[] = [
    {
      id: "org",
      position: { x: 0, y: 80 },
      data: { label: `🏦 ${orgName}\n${poolShort}` },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: baseStyle,
    },
    {
      id: "you",
      position: { x: 230, y: 80 },
      data: { label: "👤 You" },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        ...baseStyle,
        background: "linear-gradient(180deg,#1c63b3,#024FA6)",
        border: "1px solid #01356f",
        color: "#fff",
      },
    },
    {
      id: "wallet",
      position: { x: 460, y: 10 },
      data: { label: "Wallet" },
      targetPosition: Position.Left,
      style: baseStyle,
    },
    {
      id: "vault",
      position: { x: 460, y: 150 },
      data: { label: "Vault" },
      targetPosition: Position.Left,
      style: baseStyle,
    },
  ];

  const edgeStyle = { stroke: "#024FA6", strokeWidth: 2 };
  const edges: Edge[] = [
    {
      id: "e-org-you",
      source: "org",
      target: "you",
      animated: live,
      style: edgeStyle,
      label: live ? "streaming" : status,
      labelStyle: { fill: "#024FA6", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "#eaf2fc" },
    },
    { id: "e-you-wallet", source: "you", target: "wallet", animated: live, style: edgeStyle },
    { id: "e-you-vault", source: "you", target: "vault", animated: live, style: edgeStyle },
  ];

  return (
    <div className="sweem-flowmap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(2,79,166,0.14)" />
      </ReactFlow>
    </div>
  );
}
