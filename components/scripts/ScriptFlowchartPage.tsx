'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Arrow, Group, Layer, Rect, Stage, Text } from 'react-konva';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Maximize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialerRuntime } from '@/components/dialer/DialerRuntimeProvider';
import type {
  StarterScriptFlowLine,
  StarterScriptFlowNode,
} from '@/lib/scripts/default-script';
import { cn } from '@/lib/utils';

type ScriptDetail = {
  id: string;
  name: string;
  body: string;
  flow?: StarterScriptFlowNode[] | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ScriptDetailResponse = {
  script?: ScriptDetail;
  error?: string;
};

type UserProfileLite = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type FlowNodeLayout = {
  node: StarterScriptFlowNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FlowEdgeLayout = {
  id: string;
  label: string;
  source: FlowNodeLayout;
  target: FlowNodeLayout;
};

type FlowLayout = {
  nodes: FlowNodeLayout[];
  edges: FlowEdgeLayout[];
  nodeById: Map<string, FlowNodeLayout>;
  width: number;
  height: number;
};

const NODE_WIDTH = 260;
const NODE_HEIGHT = 112;
const COLUMN_GAP = 370;
const ROW_GAP = 160;
const CANVAS_PADDING = 120;
const MIN_SCALE = 0.18;
const MAX_SCALE = 1.75;

const OBJECTION_LABEL_BY_NODE_ID: Record<string, string> = {
  'quick-intro': "WHO'S THIS",
  busy: 'BUSY',
  'not-interested': 'NOT INTERESTED',
  'door-knock-objection': 'DONT DOORKNOCK',
  price: 'MONEY',
  pricing: 'MONEY',
  'price-objection': 'MONEY',
  'time-objection': 'TIME',
  'priority-objection': 'PRIORITY',
  'belief-objection': 'BELIEF',
  'tool-overlap-objection': 'CRM',
  'authority-objection': 'AUTHORITY',
  'hesitation-close': 'THINKING',
};

function fullNameFromProfile(profile: UserProfileLite | null): string {
  const fullName = [profile?.first_name, profile?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || profile?.email?.split('@')[0]?.trim() || '';
}

function firstNameFromValue(value: string | null | undefined): string {
  return (value ?? '').trim().split(/\s+/)[0] || '';
}

function personalizeScriptText(
  value: string,
  replacements: { leadName: string | null; repName: string | null }
): string {
  return value
    .replaceAll('[Name]', replacements.leadName || '[Name]')
    .replaceAll('[Rep Name]', replacements.repName || '[Rep Name]')
    .replaceAll('[Your Name]', replacements.repName || '[Your Name]');
}

function scriptLinesFromNode(node: StarterScriptFlowNode): StarterScriptFlowLine[] {
  return node.lines?.length ? node.lines : [{ speaker: 'rep', text: node.say }];
}

function compactNodeText(node: StarterScriptFlowNode): string {
  const firstLine = scriptLinesFromNode(node)[0]?.text ?? node.say;
  return firstLine.replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isObjectionNode(node: StarterScriptFlowNode): boolean {
  return node.kind === 'objection' || node.id in OBJECTION_LABEL_BY_NODE_ID;
}

function nodeFill(node: StarterScriptFlowNode, isActive: boolean): string {
  if (isActive) return '#44403c';
  if (node.kind === 'start') return '#2f3f35';
  if (isObjectionNode(node)) return '#3f2629';
  if (node.kind === 'close') return '#293548';
  if (node.kind === 'done') return '#333333';
  return '#303030';
}

function nodeStroke(node: StarterScriptFlowNode, isActive: boolean): string {
  if (isActive) return '#f5f5f4';
  if (isObjectionNode(node)) return '#ef4444';
  return '#525252';
}

function buildGraphDepths(flow: StarterScriptFlowNode[]): Map<string, number> {
  const ids = new Set(flow.map((node) => node.id));
  const depths = new Map<string, number>();
  const startId = flow[0]?.id;
  if (!startId) return depths;

  const queue: string[] = [startId];
  depths.set(startId, 0);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor];
    const currentNode = flow.find((node) => node.id === currentId);
    if (!currentNode) continue;
    const currentDepth = depths.get(currentId) ?? 0;

    currentNode.options.forEach((option) => {
      if (!ids.has(option.nextId) || depths.has(option.nextId)) return;
      depths.set(option.nextId, currentDepth + 1);
      queue.push(option.nextId);
    });
  }

  return depths;
}

function buildFlowLayout(flow: StarterScriptFlowNode[]): FlowLayout {
  const depths = buildGraphDepths(flow);
  const originalIndexById = new Map(flow.map((node, index) => [node.id, index]));
  const mainNodes = flow.filter((node) => !isObjectionNode(node));
  const maxMainDepth = Math.max(
    0,
    ...mainNodes.map((node) => depths.get(node.id) ?? 0)
  );
  const objectionColumn = maxMainDepth + 1;
  const columns = new Map<number, StarterScriptFlowNode[]>();

  flow.forEach((node) => {
    const column = isObjectionNode(node)
      ? objectionColumn
      : clamp(depths.get(node.id) ?? maxMainDepth, 0, maxMainDepth);
    const existing = columns.get(column) ?? [];
    existing.push(node);
    columns.set(column, existing);
  });

  const nodeLayouts: FlowNodeLayout[] = [];
  const sortedColumns = [...columns.entries()].sort(([a], [b]) => a - b);
  sortedColumns.forEach(([column, columnNodes]) => {
    const sortedNodes = [...columnNodes].sort(
      (a, b) => (originalIndexById.get(a.id) ?? 0) - (originalIndexById.get(b.id) ?? 0)
    );
    sortedNodes.forEach((node, row) => {
      nodeLayouts.push({
        node,
        x: CANVAS_PADDING + column * COLUMN_GAP,
        y: CANVAS_PADDING + row * ROW_GAP,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  });

  const nodeById = new Map(nodeLayouts.map((layout) => [layout.node.id, layout]));
  const edges: FlowEdgeLayout[] = flow.flatMap((node) => {
    const source = nodeById.get(node.id);
    if (!source) return [];
    return node.options.flatMap((option, optionIndex) => {
      const target = nodeById.get(option.nextId);
      if (!target) return [];
      return {
        id: `${node.id}-${option.nextId}-${optionIndex}`,
        label: option.label,
        source,
        target,
      };
    });
  });

  const graphWidth =
    Math.max(...nodeLayouts.map((layout) => layout.x + layout.width), NODE_WIDTH) +
    CANVAS_PADDING;
  const graphHeight =
    Math.max(...nodeLayouts.map((layout) => layout.y + layout.height), NODE_HEIGHT) +
    CANVAS_PADDING;

  return {
    nodes: nodeLayouts,
    edges,
    nodeById,
    width: graphWidth,
    height: graphHeight,
  };
}

function distanceBetweenTouches(touches: TouchList): number {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function centerBetweenTouches(stage: Konva.Stage, touches: TouchList) {
  const rect = stage.container().getBoundingClientRect();
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
    y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
  };
}

export function ScriptFlowchartPage({ scriptId }: { scriptId: string }) {
  const { activeLeadId, activeLeadSnapshot, diallerLeads } = useDialerRuntime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const lastPinchRef = useRef<{
    distance: number;
    scale: number;
    position: { x: number; y: number };
  } | null>(null);
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [profile, setProfile] = useState<UserProfileLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string[]>([]);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(0.55);
  const [position, setPosition] = useState({ x: 40, y: 40 });

  const endpoint = useMemo(() => {
    if (typeof window === 'undefined') return `/api/scripts/${scriptId}`;
    const params = new URLSearchParams(window.location.search);
    const query = params.toString();
    return `/api/scripts/${scriptId}${query ? `?${query}` : ''}`;
  }, [scriptId]);

  useEffect(() => {
    let active = true;
    fetch('/api/profile', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active) setProfile(data as UserProfileLite | null);
      })
      .catch(() => {
        if (active) setProfile(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadScript() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(endpoint, { credentials: 'include' });
        const data = (await response.json().catch(() => ({}))) as ScriptDetailResponse;
        if (!response.ok || !data.script) {
          throw new Error(data.error ?? 'Script could not be loaded.');
        }
        if (active) {
          setScript(data.script);
          const firstNodeId = data.script.flow?.[0]?.id ?? null;
          setSelectedNodeId(firstNodeId);
          setActivePath(firstNodeId ? [firstNodeId] : []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Script could not be loaded.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadScript();
    return () => {
      active = false;
    };
  }, [endpoint]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(360, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const flow = useMemo(() => script?.flow ?? [], [script?.flow]);
  const layout = useMemo(() => buildFlowLayout(flow), [flow]);
  const selectedLayout = selectedNodeId ? layout.nodeById.get(selectedNodeId) ?? null : null;
  const selectedNode = selectedLayout?.node ?? null;
  const activePathEdges = useMemo(() => {
    const edges = new Set<string>();
    for (let index = 0; index < activePath.length - 1; index += 1) {
      edges.add(`${activePath[index]}->${activePath[index + 1]}`);
    }
    return edges;
  }, [activePath]);
  const activeDiallerLead = useMemo(
    () =>
      activeLeadSnapshot ??
      (activeLeadId ? diallerLeads.find((lead) => lead.id === activeLeadId) ?? null : null),
    [activeLeadId, activeLeadSnapshot, diallerLeads]
  );
  const leadFullName = activeDiallerLead?.name?.trim() || '';
  const leadFirstName = firstNameFromValue(leadFullName);
  const repFullName = fullNameFromProfile(profile);
  const repFirstName = firstNameFromValue(repFullName);
  const scriptReplacements = {
    leadName: leadFirstName || leadFullName || null,
    repName: repFirstName || repFullName || null,
  };

  const fitToScreen = useCallback(() => {
    if (!layout.nodes.length || !stageSize.width || !stageSize.height) return;
    const detailPanelAllowance = stageSize.width >= 1024 ? 400 : 0;
    const usableWidth = Math.max(320, stageSize.width - detailPanelAllowance - 48);
    const usableHeight = Math.max(320, stageSize.height - 48);
    const nextScale = clamp(
      Math.min(usableWidth / layout.width, usableHeight / layout.height),
      MIN_SCALE,
      1
    );
    setScale(nextScale);
    setPosition({
      x: Math.max(24, (usableWidth - layout.width * nextScale) / 2 + 24),
      y: Math.max(24, (usableHeight - layout.height * nextScale) / 2 + 24),
    });
  }, [layout.height, layout.nodes.length, layout.width, stageSize.height, stageSize.width]);

  useEffect(() => {
    fitToScreen();
  }, [fitToScreen]);

  function selectNode(nodeId: string) {
    if (!layout.nodeById.has(nodeId)) return;
    setSelectedNodeId(nodeId);
    setActivePath((current) => {
      if (current.includes(nodeId)) return current.slice(0, current.indexOf(nodeId) + 1);
      return [nodeId];
    });
  }

  function goToNode(nextId: string) {
    if (!layout.nodeById.has(nextId)) return;
    setSelectedNodeId(nextId);
    setActivePath((current) => {
      const currentId = selectedNodeId ?? flow[0]?.id;
      if (!currentId) return [nextId];
      if (current[current.length - 1] === currentId) return [...current, nextId];
      return [currentId, nextId];
    });
  }

  function updateZoom(nextScale: number, center?: { x: number; y: number }) {
    const oldScale = scale;
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const zoomCenter = center ?? {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };
    const pointTo = {
      x: (zoomCenter.x - position.x) / oldScale,
      y: (zoomCenter.y - position.y) / oldScale,
    };
    setScale(clampedScale);
    setPosition({
      x: zoomCenter.x - pointTo.x * clampedScale,
      y: zoomCenter.y - pointTo.y * clampedScale,
    });
  }

  function resetView() {
    setScale(0.55);
    setPosition({ x: 40, y: 40 });
    const firstNodeId = flow[0]?.id ?? null;
    setSelectedNodeId(firstNodeId);
    setActivePath(firstNodeId ? [firstNodeId] : []);
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const nextScale = event.evt.deltaY > 0 ? scale / scaleBy : scale * scaleBy;
    updateZoom(nextScale, pointer);
  }

  function handleTouchMove(event: Konva.KonvaEventObject<TouchEvent>) {
    const stage = stageRef.current;
    if (!stage || event.evt.touches.length !== 2) return;
    event.evt.preventDefault();
    const distance = distanceBetweenTouches(event.evt.touches);
    const center = centerBetweenTouches(stage, event.evt.touches);
    const lastPinch = lastPinchRef.current;

    if (!lastPinch) {
      lastPinchRef.current = { distance, scale, position };
      return;
    }

    const nextScale = clamp(lastPinch.scale * (distance / lastPinch.distance), MIN_SCALE, MAX_SCALE);
    const pointTo = {
      x: (center.x - lastPinch.position.x) / lastPinch.scale,
      y: (center.y - lastPinch.position.y) / lastPinch.scale,
    };
    setScale(nextScale);
    setPosition({
      x: center.x - pointTo.x * nextScale,
      y: center.y - pointTo.y * nextScale,
    });
  }

  function handleTouchEnd() {
    lastPinchRef.current = null;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[42rem] flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="outline" size="icon" className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
            <Link href="/scripts" aria-label="Back to scripts">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-normal text-white">
              {script?.name ?? 'Solo Agent Script V2'}
            </h1>
            <p className="text-sm text-neutral-400">Flowchart view - Pan, zoom, and click any node</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => updateZoom(scale / 1.18)}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => updateZoom(scale * 1.18)}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
            aria-label="Fit to screen"
            title="Fit to screen"
            onClick={fitToScreen}
          >
            <Maximize2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
            aria-label="Reset view"
            title="Reset view"
            onClick={resetView}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </header>

      <main ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#1f1f1f]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-neutral-300">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading flowchart
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
            {error}
          </div>
        ) : flow.length > 0 ? (
          <>
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              x={position.x}
              y={position.y}
              scaleX={scale}
              scaleY={scale}
              draggable
              onDragEnd={(event) => setPosition({ x: event.target.x(), y: event.target.y() })}
              onWheel={handleWheel}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <Layer>
                <Rect
                  x={-4000}
                  y={-4000}
                  width={10000}
                  height={10000}
                  fill="#1f1f1f"
                  listening={false}
                />

                {layout.edges.map((edge) => {
                  const sourceX = edge.source.x + edge.source.width;
                  const sourceY = edge.source.y + edge.source.height / 2;
                  const targetX = edge.target.x;
                  const targetY = edge.target.y + edge.target.height / 2;
                  const controlOffset = Math.max(90, Math.abs(targetX - sourceX) / 2);
                  const isActive =
                    selectedNodeId === edge.source.node.id ||
                    selectedNodeId === edge.target.node.id ||
                    activePathEdges.has(`${edge.source.node.id}->${edge.target.node.id}`);
                  const labelX = (sourceX + targetX) / 2 - 66;
                  const labelY = (sourceY + targetY) / 2 - 16;

                  return (
                    <Group
                      key={edge.id}
                      onClick={() => goToNode(edge.target.node.id)}
                      onTap={() => goToNode(edge.target.node.id)}
                    >
                      <Arrow
                        points={[
                          sourceX,
                          sourceY,
                          sourceX + controlOffset,
                          sourceY,
                          targetX - controlOffset,
                          targetY,
                          targetX,
                          targetY,
                        ]}
                        bezier
                        stroke={isActive ? '#fafafa' : '#a3a3a3'}
                        fill={isActive ? '#fafafa' : '#a3a3a3'}
                        strokeWidth={isActive ? 2.5 : 1.6}
                        pointerLength={10}
                        pointerWidth={10}
                      />
                      <Rect
                        x={labelX - 8}
                        y={labelY - 4}
                        width={148}
                        height={34}
                        fill="#1f1f1f"
                        opacity={0.9}
                        cornerRadius={4}
                      />
                      <Text
                        x={labelX}
                        y={labelY}
                        width={132}
                        height={30}
                        text={edge.label}
                        fill={isActive ? '#ffffff' : '#d4d4d4'}
                        fontSize={12}
                        lineHeight={1.15}
                        align="center"
                        verticalAlign="middle"
                      />
                    </Group>
                  );
                })}

                {layout.nodes.map((layoutNode) => {
                  const node = layoutNode.node;
                  const isActive = selectedNodeId === node.id;
                  const isInPath = activePath.includes(node.id);
                  return (
                    <Group
                      key={node.id}
                      x={layoutNode.x}
                      y={layoutNode.y}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectNode(node.id);
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        selectNode(node.id);
                      }}
                    >
                      <Rect
                        width={layoutNode.width}
                        height={layoutNode.height}
                        fill={nodeFill(node, isActive)}
                        stroke={nodeStroke(node, isActive)}
                        strokeWidth={isActive ? 3 : isInPath ? 2 : 1}
                        cornerRadius={7}
                        shadowColor="#000000"
                        shadowOpacity={0.28}
                        shadowBlur={14}
                        shadowOffsetY={8}
                      />
                      <Text
                        x={16}
                        y={14}
                        width={layoutNode.width - 32}
                        height={20}
                        text={node.label || node.title}
                        fill={isObjectionNode(node) ? '#fecaca' : '#f5f5f5'}
                        fontSize={16}
                        fontStyle="bold"
                        ellipsis
                      />
                      <Text
                        x={16}
                        y={40}
                        width={layoutNode.width - 32}
                        height={18}
                        text={node.title}
                        fill="#d4d4d4"
                        fontSize={12}
                        ellipsis
                      />
                      <Text
                        x={16}
                        y={66}
                        width={layoutNode.width - 32}
                        height={34}
                        text={personalizeScriptText(compactNodeText(node), scriptReplacements)}
                        fill="#a3a3a3"
                        fontSize={11}
                        lineHeight={1.25}
                        ellipsis
                      />
                    </Group>
                  );
                })}
              </Layer>
            </Stage>

            <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-xs font-medium text-neutral-300 shadow-lg">
              {Math.round(scale * 100)}% - {layout.nodes.length} cards - {layout.edges.length} routes
            </div>

            {selectedNode ? (
              <aside className="absolute bottom-3 left-3 right-3 max-h-[45%] overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950/95 p-4 shadow-2xl lg:bottom-3 lg:left-auto lg:top-3 lg:w-96 lg:max-h-none">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-500">
                      {selectedNode.label}
                    </div>
                    <h2 className="text-lg font-semibold leading-tight text-white">{selectedNode.title}</h2>
                  </div>
                  <div
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-bold',
                      isObjectionNode(selectedNode)
                        ? 'bg-red-500/15 text-red-200'
                        : 'bg-neutral-800 text-neutral-200'
                    )}
                  >
                    {selectedNode.kind}
                  </div>
                </div>

                <div className="space-y-3">
                  {scriptLinesFromNode(selectedNode).map((line, index) => (
                    <div
                      key={`${selectedNode.id}-${index}`}
                      className={cn(
                        'rounded-md border p-3',
                        line.speaker === 'person'
                          ? 'border-red-500/35 bg-red-500/10 text-red-100'
                          : 'border-neutral-700 bg-neutral-900 text-neutral-100'
                      )}
                    >
                      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                        {line.speaker === 'person' ? 'Person' : 'Rep'}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {personalizeScriptText(line.text, scriptReplacements)}
                      </p>
                    </div>
                  ))}
                </div>

                {selectedNode.coach ? (
                  <div className="mt-3 rounded-md border border-neutral-700 bg-neutral-900 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                      Coach
                    </div>
                    <p className="text-sm leading-6 text-neutral-300">
                      {personalizeScriptText(selectedNode.coach, scriptReplacements)}
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2">
                  {selectedNode.options.map((option) => (
                    <Button
                      key={`${selectedNode.id}-${option.nextId}-${option.label}`}
                      type="button"
                      variant="outline"
                      className="h-auto min-h-11 justify-between gap-3 whitespace-normal border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-sm font-semibold text-neutral-100 hover:bg-neutral-800"
                      onClick={() => goToNode(option.nextId)}
                      disabled={!layout.nodeById.has(option.nextId)}
                    >
                      <span>{option.label}</span>
                      <ArrowRight className="size-4 shrink-0" />
                    </Button>
                  ))}
                </div>
              </aside>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-300">
            No flow found.
          </div>
        )}
      </main>
    </div>
  );
}
