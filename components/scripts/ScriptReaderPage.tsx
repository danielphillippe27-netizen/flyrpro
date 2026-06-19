'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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

function kindClassName(kind: StarterScriptFlowNode['kind']) {
  if (kind === 'objection') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (kind === 'close') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (kind === 'done') return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-primary/40 bg-primary/10 text-primary';
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

function speakerLabel(speaker: StarterScriptFlowLine['speaker']): string {
  return speaker === 'person' ? 'Person' : 'Rep';
}

function speakerClassName(speaker: StarterScriptFlowLine['speaker']): string {
  return speaker === 'person'
    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    : 'border-primary/40 bg-primary/10 text-primary';
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
  const [history, setHistory] = useState<string[]>(['start']);
  const [draftFlow, setDraftFlow] = useState<StarterScriptFlowNode[]>(STARTER_SCRIPT_FLOW);
  const [nextLineSpeaker, setNextLineSpeaker] = useState<StarterScriptFlowLine['speaker']>('person');
  const flowScrollerRef = useRef<HTMLDivElement | null>(null);

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
  const flowPathSignature = useMemo(() => flow.map((node) => node.id).join('|'), [flow]);
  const firstFlowId = flow[0]?.id;

  useEffect(() => {
    if (!firstFlowId) return;
    setHistory([firstFlowId]);
  }, [firstFlowId, flowPathSignature]);

  const activeId = history[history.length - 1];
  const nodeById = useMemo(() => new Map(flow.map((node) => [node.id, node])), [flow]);
  const activeNode = nodeById.get(activeId) ?? flow[0] ?? null;
  const pathNodes = history.map((id) => nodeById.get(id)).filter(Boolean) as StarterScriptFlowNode[];
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
    const scroller = flowScrollerRef.current;
    if (!scroller || pathNodes.length <= 1) return;
    window.requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }, [pathNodes.length]);

  function goToNode(nextId: string) {
    setHistory((current) => {
      if (current[current.length - 1] === nextId) return current;
      return [...current, nextId];
    });
  }

  function focusPathStep(index: number) {
    setHistory((current) => current.slice(0, index + 1));
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
                    {pathNodes.map((node) => node.label).join(' -> ')}
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
                <Button variant="outline" onClick={goBack} disabled={history.length <= 1}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button variant="outline" onClick={restart}>
                  <RotateCcw className="size-4" />
                  Restart
                </Button>
              </div>
            </div>

            <section className="rounded-lg border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-card-foreground">Live call path</h2>
                  <p className="text-xs text-muted-foreground">
                    Click a response on the focused step to move the flow to the right.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lead: {leadFullName || 'No active dialler lead'} · Rep: {repFullName || 'Rep Name'}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  Step {pathNodes.length}
                </Badge>
              </div>

              <div ref={flowScrollerRef} className="overflow-x-auto px-4 py-5">
                <div className="flex min-w-max items-stretch gap-3 pb-2">
                  {pathNodes.map((node, index) => {
                    const isActive = activeNode?.id === node.id && index === pathNodes.length - 1;
                    const scriptLines = scriptLinesFromNode(node);
                    return (
                      <div key={`${node.id}-${index}`} className="flex items-stretch gap-3">
                        <div
                          role={isActive ? undefined : 'button'}
                          tabIndex={isActive ? undefined : 0}
                          onClick={() => {
                            if (!isActive) focusPathStep(index);
                          }}
                          onKeyDown={(event) => {
                            if (isActive) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              focusPathStep(index);
                            }
                          }}
                          aria-current={isActive ? 'step' : undefined}
                          className={cn(
                            'flex min-h-[34rem] flex-col rounded-lg border bg-background text-left shadow-sm transition-colors',
                            isActive
                              ? 'w-[min(78vw,36rem)] border-primary/50 ring-2 ring-primary/15'
                              : 'w-[18rem] border-border hover:border-primary/40 hover:bg-accent/30'
                          )}
                        >
                          <div className="border-b border-border p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={kindClassName(node.kind)}>
                                {kindLabel(node.kind)}
                              </Badge>
                              <span className="text-xs font-medium uppercase text-muted-foreground">
                                {node.label}
                              </span>
                            </div>
                            <h3
                              className={cn(
                                'mt-3 font-semibold text-foreground',
                                isActive && editing ? 'sr-only' : isActive ? 'text-2xl' : 'line-clamp-2 text-base'
                              )}
                            >
                              {node.title}
                            </h3>
                            {isActive && editing ? (
                              <div className="mt-3 space-y-2">
                                <Label htmlFor={`script-title-${node.id}`}>Title</Label>
                                <Input
                                  id={`script-title-${node.id}`}
                                  value={node.title}
                                  onChange={(event) => updateDraftNode(node.id, { title: event.target.value })}
                                  maxLength={2000}
                                />
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-1 flex-col p-4">
                            <div className="rounded-md border border-border bg-card p-4">
                              {isActive && editing ? (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <Label>Script lines</Label>
                                    <div className="flex items-center gap-2">
                                      <div className="flex rounded-md border border-border bg-background p-1">
                                        {(['rep', 'person'] as const).map((speaker) => (
                                          <button
                                            key={speaker}
                                            type="button"
                                            onClick={() => setNextLineSpeaker(speaker)}
                                            className={cn(
                                              'rounded px-3 py-1.5 text-xs font-semibold transition-colors',
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
                                        onClick={() => addDraftLine(node.id)}
                                      >
                                        <MessageSquarePlus className="size-4" />
                                        Add line
                                      </Button>
                                    </div>
                                  </div>

                                  {scriptLines.map((line, lineIndex) => (
                                    <div
                                      key={`${node.id}-line-${lineIndex}`}
                                      className={cn(
                                        'space-y-2 rounded-md border p-3',
                                        line.speaker === 'person'
                                          ? 'border-red-500/30 bg-red-500/5'
                                          : 'border-border bg-background'
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <Badge variant="outline" className={speakerClassName(line.speaker)}>
                                          {speakerLabel(line.speaker)}
                                        </Badge>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-8"
                                            aria-label="Switch speaker"
                                            title="Switch speaker"
                                            onClick={() =>
                                              updateDraftLine(node.id, lineIndex, {
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
                                              onClick={() => removeDraftLine(node.id, lineIndex)}
                                            >
                                              <Trash2 className="size-4" />
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                      <Textarea
                                        value={line.text}
                                        onChange={(event) =>
                                          updateDraftLine(node.id, lineIndex, { text: event.target.value })
                                        }
                                        className={cn(
                                          'min-h-24 resize-y text-base leading-7',
                                          line.speaker === 'person' &&
                                            'border-red-500/30 text-red-700 focus-visible:ring-red-500 dark:text-red-300'
                                        )}
                                        maxLength={2000}
                                      />
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <>
                                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                                    Say
                                  </div>
                                  <div
                                    className={cn(
                                      'mt-3 space-y-3',
                                      !isActive && 'line-clamp-6'
                                    )}
                                  >
                                    {scriptLines.map((line, lineIndex) => (
                                      <p
                                        key={`${node.id}-read-line-${lineIndex}`}
                                        className={cn(
                                          'whitespace-pre-wrap',
                                          isActive ? 'text-xl leading-8' : 'text-sm leading-6',
                                          line.speaker === 'person'
                                            ? 'font-medium text-red-700 dark:text-red-300'
                                            : 'text-foreground'
                                        )}
                                      >
                                        {line.speaker === 'person' ? (
                                          <span className="mr-2 text-xs font-semibold uppercase tracking-normal text-red-500">
                                            Person
                                          </span>
                                        ) : null}
                                        {personalizeScriptText(line.text, scriptReplacements)}
                                      </p>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            {isActive && editing ? (
                              <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/30 p-4">
                                <Label htmlFor={`script-coach-${node.id}`}>Coach</Label>
                                <Textarea
                                  id={`script-coach-${node.id}`}
                                  value={node.coach ?? ''}
                                  onChange={(event) => updateDraftNode(node.id, { coach: event.target.value })}
                                  className="min-h-24 resize-y"
                                  maxLength={2000}
                                />
                              </div>
                            ) : node.coach && isActive ? (
                              <div className="mt-4 rounded-md border border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
                                {personalizeScriptText(node.coach, scriptReplacements)}
                              </div>
                            ) : null}

                            <div className="mt-auto pt-5">
                              {isActive ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {node.options.map((option, optionIndex) =>
                                    editing ? (
                                      <div
                                        key={`${node.id}-${option.nextId}-${optionIndex}`}
                                        className="space-y-2 rounded-md border border-border bg-card p-3"
                                      >
                                        <Label htmlFor={`script-option-${node.id}-${optionIndex}`}>
                                          Response {optionIndex + 1}
                                        </Label>
                                        <Input
                                          id={`script-option-${node.id}-${optionIndex}`}
                                          value={option.label}
                                          onChange={(event) =>
                                            updateDraftOption(node.id, optionIndex, event.target.value)
                                          }
                                          maxLength={120}
                                        />
                                      </div>
                                    ) : (
                                      <Button
                                        key={`${node.id}-${option.nextId}-${option.label}`}
                                        type="button"
                                        variant={node.kind === 'done' ? 'default' : 'outline'}
                                        className="h-auto justify-between whitespace-normal px-4 py-3 text-left"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          goToNode(option.nextId);
                                        }}
                                      >
                                        <span>{option.label}</span>
                                        <ArrowRight className="size-4" />
                                      </Button>
                                    )
                                  )}
                                </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Click to return to this step.
                              </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {index < pathNodes.length - 1 ? (
                          <div className="flex w-8 shrink-0 items-center justify-center text-muted-foreground">
                            <ArrowRight className="size-5" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
