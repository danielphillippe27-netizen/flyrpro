'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Edit3,
  Loader2,
  MessageSquarePlus,
  Repeat2,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  STARTER_SCRIPT_FLOW,
  STARTER_SCRIPT_ID,
  STARTER_SCRIPT_NAME,
  type StarterScriptFlowLine,
  type StarterScriptFlowNode,
} from '@/lib/scripts/default-script';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDialerRuntime } from '@/components/dialer/DialerRuntimeProvider';

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

function splitScriptBody(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildLinearFlow(script: ScriptDetail): StarterScriptFlowNode[] {
  const parts = splitScriptBody(script.body);
  const bodyParts = parts.length > 0 ? parts : [script.body || script.name];

  return bodyParts.map((part, index): StarterScriptFlowNode => {
    const [firstLine, ...rest] = part.split('\n').map((line) => line.trim()).filter(Boolean);
    const isLast = index === bodyParts.length - 1;
    const nextId = isLast ? 'done' : `step-${index + 2}`;
    return {
      id: `step-${index + 1}`,
      label: index === 0 ? 'Start' : isLast ? 'Close' : `Step ${index + 1}`,
      kind: index === 0 ? 'start' : isLast ? 'close' : 'question',
      title: firstLine?.replace(/:$/, '') || `Step ${index + 1}`,
      say: rest.length > 0 ? rest.join('\n') : firstLine || part,
      options: [{ label: isLast ? 'Complete' : 'Next', nextId }],
    };
  }).concat({
    id: 'done',
    label: 'Done',
    kind: 'done',
    title: 'Call complete',
    say: 'Log the outcome, add the follow-up, and move to the next call.',
    options: [{ label: 'Start again', nextId: 'step-1' }],
  });
}

function kindLabel(kind: StarterScriptFlowNode['kind']) {
  if (kind === 'start') return 'Start';
  if (kind === 'question') return 'Question';
  if (kind === 'objection') return 'Objection';
  if (kind === 'close') return 'Close';
  return 'Done';
}

function scriptLinesFromNode(node: StarterScriptFlowNode): StarterScriptFlowLine[] {
  return node.lines?.length ? node.lines : [{ speaker: 'rep', text: node.say }];
}

function scriptLinesToSay(lines: StarterScriptFlowLine[]): string {
  return lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join('\n');
}

function compactNodeText(node: StarterScriptFlowNode): string {
  const firstLine = scriptLinesFromNode(node)[0]?.text ?? node.say;
  return firstLine.replace(/\s+/g, ' ').trim();
}

function speakerLabel(speaker: StarterScriptFlowLine['speaker']): string {
  return speaker === 'person' ? 'Person' : 'Rep';
}

function speakerClassName(speaker: StarterScriptFlowLine['speaker']): string {
  return speaker === 'person'
    ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-300'
    : 'border-zinc-400 bg-zinc-100 text-zinc-800 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100';
}

const OBJECTION_LABEL_BY_NODE_ID: Record<string, string> = {
  busy: 'BUSY',
  'not-interested': 'NOT INTERESTED',
  'door-knock-objection': 'DONT DOORKNOCK',
  'interrupting-homeowners-objection': 'INTERRUPTING',
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

const OBJECTION_TRAY_EXCLUDED_NODE_IDS = new Set(['quick-intro']);

const OBJECTION_TRAY_ORDER_BY_NODE_ID: Record<string, number> = {
  'door-knock-objection': 0,
  busy: 10,
  price: 20,
  pricing: 20,
  'price-objection': 20,
  'time-objection': 30,
  'priority-objection': 40,
  'belief-objection': 50,
  'interrupting-homeowners-objection': 60,
  'tool-overlap-objection': 70,
  'authority-objection': 80,
  'hesitation-close': 90,
  'not-interested': 100,
};

function objectionOptionLabel(
  option: StarterScriptFlowNode['options'][number],
  targetNode: StarterScriptFlowNode | undefined
): string {
  return (
    OBJECTION_LABEL_BY_NODE_ID[option.nextId] ??
    targetNode?.label?.trim().toUpperCase() ??
    option.label.trim().toUpperCase()
  );
}

function sanitizeDraftFlowForSave(flow: StarterScriptFlowNode[]): StarterScriptFlowNode[] {
  return flow.map((node) => {
    if (!node.lines?.length) {
      return {
        ...node,
        title: node.title.trim(),
        say: node.say.trim(),
        coach: node.coach?.trim() || undefined,
        options: node.options.map((option) => ({ ...option, label: option.label.trim() })),
      };
    }

    const lines = node.lines
      .map((line) => ({
        speaker: line.speaker,
        text: line.text.trim(),
      }))
      .filter((line) => line.text);

    const say = scriptLinesToSay(lines);
    return {
      ...node,
      title: node.title.trim(),
      say: say || node.say.trim(),
      lines: lines.length ? lines : undefined,
      coach: node.coach?.trim() || undefined,
      options: node.options.map((option) => ({ ...option, label: option.label.trim() })),
    };
  });
}

export function ScriptReaderPage({ scriptId }: { scriptId: string }) {
  const { activeLeadId, activeLeadSnapshot, diallerLeads } = useDialerRuntime();
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [profile, setProfile] = useState<UserProfileLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [draftFlow, setDraftFlow] = useState<StarterScriptFlowNode[]>(STARTER_SCRIPT_FLOW);
  const [nextLineSpeaker, setNextLineSpeaker] = useState<StarterScriptFlowLine['speaker']>('person');

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
        if (active) setScript(data.script);
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
    if (!script) return;
    if (script.flow?.length) {
      setDraftFlow(script.flow);
    } else if (script.id === STARTER_SCRIPT_ID || script.name === STARTER_SCRIPT_NAME) {
      setDraftFlow(STARTER_SCRIPT_FLOW);
    }
  }, [script]);

  const flow = useMemo(() => {
    if (!script) return [];
    if (editing && draftFlow.length > 0) {
      return draftFlow;
    }
    if (script.flow?.length) {
      return script.flow;
    }
    if (script.id === STARTER_SCRIPT_ID || script.name === STARTER_SCRIPT_NAME) {
      return STARTER_SCRIPT_FLOW;
    }
    return buildLinearFlow(script);
  }, [draftFlow, editing, script]);

  const canEditFlow = Boolean(script && (script.flow?.length || script.id === STARTER_SCRIPT_ID || script.name === STARTER_SCRIPT_NAME));
  const flowSignature = useMemo(() => flow.map((node) => node.id).join('|'), [flow]);
  const nodeById = useMemo(() => new Map(flow.map((node) => [node.id, node])), [flow]);
  const activeId = history[history.length - 1] ?? flow[0]?.id ?? null;
  const activeNode = activeId ? nodeById.get(activeId) ?? flow[0] ?? null : flow[0] ?? null;
  const activeIndex = activeNode ? flow.findIndex((node) => node.id === activeNode.id) : -1;
  const pathNodes = history.map((id) => nodeById.get(id)).filter(Boolean) as StarterScriptFlowNode[];
  const activeOptions = useMemo(
    () =>
      activeNode
        ? activeNode.options.map((option, optionIndex) => ({
            option,
            optionIndex,
            targetNode: nodeById.get(option.nextId),
          }))
        : [],
    [activeNode, nodeById]
  );
  const answerOptions = activeOptions.filter(
    ({ targetNode }) => !targetNode || targetNode.kind !== 'objection'
  );
  const objectionOptions = useMemo(() => {
    const seenNodeIds = new Set<string>();
    return flow
      .filter((node) => node.kind === 'objection' || node.id in OBJECTION_LABEL_BY_NODE_ID)
      .filter((node) => !OBJECTION_TRAY_EXCLUDED_NODE_IDS.has(node.id))
      .filter((node) => {
        if (seenNodeIds.has(node.id)) return false;
        seenNodeIds.add(node.id);
        return true;
      })
      .sort((firstNode, secondNode) => {
        const firstOrder = OBJECTION_TRAY_ORDER_BY_NODE_ID[firstNode.id] ?? 50;
        const secondOrder = OBJECTION_TRAY_ORDER_BY_NODE_ID[secondNode.id] ?? 50;
        if (firstOrder !== secondOrder) return firstOrder - secondOrder;
        return firstNode.label.localeCompare(secondNode.label);
      })
      .map((targetNode) => ({
        option: {
          label: targetNode.label,
          nextId: targetNode.id,
        },
        targetNode,
      }));
  }, [flow]);
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

  useEffect(() => {
    if (!flow[0]) return;
    setHistory((current) => {
      const currentActiveId = current[current.length - 1];
      if (currentActiveId && nodeById.has(currentActiveId)) return current;
      return [flow[0].id];
    });
  }, [flow, flowSignature, nodeById]);

  function goToNode(nextId: string) {
    if (!nodeById.has(nextId)) return;
    setHistory((current) => {
      if (current[current.length - 1] === nextId) return current;
      return [...current, nextId];
    });
  }

  function goBack() {
    setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }

  function restart() {
    if (flow[0]) setHistory([flow[0].id]);
  }

  function updateDraftNode(nodeId: string, update: Partial<Pick<StarterScriptFlowNode, 'title' | 'say' | 'coach'>>) {
    setDraftFlow((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...update,
            }
          : node
      )
    );
  }

  function updateDraftLine(
    nodeId: string,
    lineIndex: number,
    update: Partial<StarterScriptFlowLine>
  ) {
    setDraftFlow((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const lines = scriptLinesFromNode(node).map((line, index) =>
          index === lineIndex
            ? {
                ...line,
                ...update,
              }
            : line
        );

        return {
          ...node,
          lines,
          say: scriptLinesToSay(lines) || node.say,
        };
      })
    );
  }

  function addDraftLine(nodeId: string) {
    setDraftFlow((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const lines = [
          ...scriptLinesFromNode(node),
          {
            speaker: nextLineSpeaker,
            text: '',
          },
        ];
        return {
          ...node,
          lines,
          say: scriptLinesToSay(lines) || node.say,
        };
      })
    );
  }

  function removeDraftLine(nodeId: string, lineIndex: number) {
    setDraftFlow((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const lines = scriptLinesFromNode(node).filter((_, index) => index !== lineIndex);
        const fallbackLines = lines.length ? lines : [{ speaker: 'rep' as const, text: node.say }];
        return {
          ...node,
          lines: fallbackLines,
          say: scriptLinesToSay(fallbackLines) || node.say,
        };
      })
    );
  }

  function updateDraftOption(nodeId: string, optionIndex: number, label: string) {
    setDraftFlow((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              options: node.options.map((option, index) =>
                index === optionIndex
                  ? {
                      ...option,
                      label,
                    }
                  : option
              ),
            }
          : node
      )
    );
  }

  function startEditing() {
    if (!script || !canEditFlow) return;
    setDraftFlow(script.flow?.length ? script.flow : STARTER_SCRIPT_FLOW);
    setEditing(true);
    setError(null);
  }

  function cancelEditing() {
    if (script?.flow?.length) {
      setDraftFlow(script.flow);
    } else {
      setDraftFlow(STARTER_SCRIPT_FLOW);
    }
    setEditing(false);
    setError(null);
  }

  async function saveEdits() {
    if (!script || !canEditFlow) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ flow: sanitizeDraftFlowForSave(draftFlow) }),
      });
      const data = (await response.json().catch(() => ({}))) as ScriptDetailResponse;
      if (!response.ok || !data.script) {
        throw new Error(data.error ?? 'Script could not be saved.');
      }
      setScript(data.script);
      setDraftFlow(data.script.flow?.length ? data.script.flow : STARTER_SCRIPT_FLOW);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Script could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex min-h-[16rem] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        ) : script ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Button asChild variant="outline" size="icon" aria-label="Back to scripts" title="Back to scripts">
                  <Link href="/scripts">
                    <ArrowLeft className="size-4" />
                  </Link>
                </Button>
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground">
                    {script.name}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Lead: {leadFullName || 'No active dialler lead'} · Rep: {repFullName || 'Rep Name'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canEditFlow ? (
                  editing ? (
                    <>
                      <Button variant="outline" onClick={cancelEditing} disabled={saving}>
                        <X className="size-4" />
                        Cancel
                      </Button>
                      <Button onClick={saveEdits} disabled={saving}>
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={startEditing}>
                      <Edit3 className="size-4" />
                      Edit
                    </Button>
                  )
                ) : null}
              </div>
            </div>

            {activeNode ? (
              <section className="space-y-4">
                {pathNodes.length > 1 ? (
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-max items-stretch gap-3">
                      {pathNodes.slice(0, -1).map((node, index) => (
                        <button
                          key={`${node.id}-${index}`}
                          type="button"
                          onClick={() => setHistory((current) => current.slice(0, index + 1))}
                          className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card p-3 text-left text-card-foreground opacity-70 shadow-sm transition hover:border-primary/40 hover:opacity-100"
                        >
                          <div className="mb-3 flex items-center gap-2">
                            <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
                              {node.label || kindLabel(node.kind)}
                            </Badge>
                            <span className="truncate text-xs font-medium text-muted-foreground">
                              Step {index + 1}
                            </span>
                          </div>
                          <div className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {personalizeScriptText(compactNodeText(node), scriptReplacements)}
                          </div>
                        </button>
                      ))}
                      <div className="flex w-72 shrink-0 flex-col rounded-lg border border-primary/40 bg-card p-3 text-left text-card-foreground shadow-sm ring-2 ring-primary/10">
                        <div className="mb-3 flex items-center gap-2">
                          <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
                            {activeNode.label || kindLabel(activeNode.kind)}
                          </Badge>
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            Current
                          </span>
                        </div>
                        <div className="line-clamp-3 text-sm font-medium leading-6">
                          {personalizeScriptText(compactNodeText(activeNode), scriptReplacements)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
                        {activeNode.label || kindLabel(activeNode.kind)}
                      </Badge>
                      <span className="truncate text-sm font-medium text-muted-foreground">
                        {activeNode.title}
                      </span>
                    </div>
                    {editing ? (
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-md border border-border bg-background p-1">
                          {(['rep', 'person'] as const).map((speaker) => (
                            <button
                              key={speaker}
                              type="button"
                              onClick={() => setNextLineSpeaker(speaker)}
                              className={cn(
                                'rounded px-2.5 py-1 text-xs font-semibold transition-colors',
                                nextLineSpeaker === speaker
                                  ? speakerClassName(speaker)
                                  : 'text-muted-foreground hover:bg-accent'
                              )}
                            >
                              {speakerLabel(speaker)}
                            </button>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addDraftLine(activeNode.id)}
                        >
                          <MessageSquarePlus className="size-4" />
                          Add line
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {editing ? (
                    <div className="mb-4 space-y-2">
                      <Label htmlFor={`script-title-${activeNode.id}`}>Title</Label>
                      <Input
                        id={`script-title-${activeNode.id}`}
                        value={activeNode.title}
                        onChange={(event) => updateDraftNode(activeNode.id, { title: event.target.value })}
                        maxLength={2000}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {scriptLinesFromNode(activeNode).map((line, lineIndex, scriptLines) => (
                      <div
                        key={`${activeNode.id}-line-${lineIndex}`}
                        className={cn(
                          'rounded-lg border p-4',
                          line.speaker === 'person'
                            ? 'border-red-300 bg-red-50/70 dark:border-red-500/40 dark:bg-red-500/10'
                            : 'border-border bg-background'
                        )}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <Badge variant="outline" className={speakerClassName(line.speaker)}>
                            {speakerLabel(line.speaker)}
                          </Badge>
                          {editing ? (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Switch speaker"
                                title="Switch speaker"
                                onClick={() =>
                                  updateDraftLine(activeNode.id, lineIndex, {
                                    speaker: line.speaker === 'person' ? 'rep' : 'person',
                                  })
                                }
                              >
                                <Repeat2 className="size-4" />
                              </Button>
                              {scriptLines.length > 1 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-destructive"
                                  aria-label="Remove line"
                                  title="Remove line"
                                  onClick={() => removeDraftLine(activeNode.id, lineIndex)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {editing ? (
                          <Textarea
                            value={line.text}
                            onChange={(event) =>
                              updateDraftLine(activeNode.id, lineIndex, { text: event.target.value })
                            }
                            className={cn(
                              'min-h-32 resize-y rounded-md bg-white text-lg leading-7 shadow-sm dark:bg-background',
                              line.speaker === 'person' &&
                                'border-red-300 bg-red-50/60 text-red-700 focus-visible:ring-red-500 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
                            )}
                            maxLength={2000}
                          />
                        ) : (
                          <div
                            className={cn(
                              'min-h-24 whitespace-pre-wrap rounded-md border border-border bg-white p-4 text-lg leading-8 shadow-sm dark:bg-background',
                              line.speaker === 'person' &&
                                'border-red-300 bg-red-50/60 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
                            )}
                          >
                            {personalizeScriptText(line.text, scriptReplacements)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-lg border border-border bg-background p-4">
                    <Badge variant="outline" className="mb-3 border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
                      Coach
                    </Badge>
                    {editing ? (
                      <Textarea
                        id={`script-coach-${activeNode.id}`}
                        value={activeNode.coach ?? ''}
                        onChange={(event) => updateDraftNode(activeNode.id, { coach: event.target.value })}
                        className="min-h-24 resize-y bg-white dark:bg-background"
                        maxLength={2000}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {activeNode.coach
                          ? personalizeScriptText(activeNode.coach, scriptReplacements)
                          : 'No coaching note.'}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 text-xs font-medium text-muted-foreground">
                    Step {activeIndex + 1} of {flow.length}
                    {pathNodes.length > 1 ? ` · ${pathNodes.map((node) => node.label).join(' -> ')}` : ''}
                  </div>
                </article>

                <aside className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-card-foreground">Answers</h2>
                      <p className="text-xs text-muted-foreground">Click one to move right.</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Restart script"
                      title="Restart script"
                      onClick={restart}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  </div>

                  {editing ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {activeOptions.map(({ option, optionIndex }) => (
                        <div
                          key={`${activeNode.id}-${option.nextId}-${optionIndex}`}
                          className="space-y-2 rounded-lg border border-border bg-background p-3"
                        >
                          <Label htmlFor={`script-option-${activeNode.id}-${optionIndex}`}>
                            Response {optionIndex + 1}
                          </Label>
                          <Input
                            id={`script-option-${activeNode.id}-${optionIndex}`}
                            value={option.label}
                            onChange={(event) =>
                              updateDraftOption(activeNode.id, optionIndex, event.target.value)
                            }
                            maxLength={120}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {answerOptions.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {answerOptions.map(({ option }) => (
                            <Button
                              key={`${activeNode.id}-${option.nextId}-${option.label}`}
                              type="button"
                              variant={activeNode.kind === 'done' ? 'default' : 'outline'}
                              className="h-auto min-h-16 w-full justify-between gap-3 whitespace-normal px-4 py-3 text-left text-base font-semibold"
                              onClick={() => goToNode(option.nextId)}
                              disabled={!nodeById.has(option.nextId)}
                            >
                              <span>{option.label}</span>
                              <ArrowRight className="size-4 shrink-0" />
                            </Button>
                          ))}
                        </div>
                      ) : null}

                      {objectionOptions.length > 0 ? (
                        <div className="rounded-lg border border-red-300 bg-red-50/70 p-3 dark:border-red-500/40 dark:bg-red-500/10">
                          <div className="mb-3 flex items-center gap-2">
                            <Badge variant="outline" className="border-red-400 bg-white text-red-700 dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-300">
                              Objections
                            </Badge>
                            <span className="text-xs font-medium text-red-700/80 dark:text-red-300/80">
                              Handle without leaving the flow.
                            </span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {objectionOptions.map(({ option, targetNode }) => (
                              <Button
                                key={`${activeNode.id}-${option.nextId}-${option.label}`}
                                type="button"
                                variant="outline"
                                className={cn(
                                  'h-auto min-h-14 w-full justify-between gap-3 whitespace-normal border-red-300 bg-white px-4 py-3 text-left text-sm font-bold text-red-700 shadow-sm hover:border-red-400 hover:bg-red-100 dark:border-red-500/50 dark:bg-background dark:text-red-300 dark:hover:bg-red-500/10',
                                  option.nextId === 'not-interested' && 'lg:col-start-4'
                                )}
                                onClick={() => goToNode(option.nextId)}
                                disabled={!nodeById.has(option.nextId)}
                              >
                                <span>{objectionOptionLabel(option, targetNode)}</span>
                                <ArrowRight className="size-4 shrink-0" />
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start sm:w-auto"
                      onClick={goBack}
                      disabled={history.length <= 1}
                    >
                      <ArrowLeft className="size-4" />
                      Back
                    </Button>
                  </div>
                </aside>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
