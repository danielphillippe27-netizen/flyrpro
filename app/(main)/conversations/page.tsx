'use client';

import type { ConversationTarget } from '@/lib/field-recordings/targets';
import type { CampaignTiming } from '@/lib/field-recordings/analytics';
import { useCallback, useEffect, useRef, useState } from 'react';
import CampaignInsights from './CampaignInsights';
import ConversationInsights from './ConversationInsights';
import { createClient } from '@/lib/supabase/client';
import ConversationContactPreference from './ConversationContactPreference';
import ConversationApplication from './ConversationApplication';
import ConversationSplit from './ConversationSplit';
import ConversationMerge from './ConversationMerge';
import ConversationHistory from './ConversationHistory';
import RecordingDeletion from './RecordingDeletion';
import DeletionRecovery from './DeletionRecovery';
import PreferenceRecovery from './PreferenceRecovery';
import ConversationAssignment from './ConversationAssignment';
import RecordingAudio from './RecordingAudio';
import ConversationReview, { type ReviewConversation } from './ConversationReview';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Recording = { user_id: string; workspace_id: string; id: string; session_id: string; started_at: string; capture_state: string; processing_state: string };
type Conversation = ReviewConversation & { chunk_id: string | null; id: string; summary: string | null; note: string | null; review_state: string; target_id: string | null; target_confirmed: boolean; segments: { id: string; text: string; startMs: number; endMs: number; speaker: string | null }[]; analysis: unknown; timing?: { clock?: string; pauseMapping?: string } | null };
export default function ConversationsPage() {
  const { currentWorkspaceId } = useWorkspace();
  const [currentOwner, setCurrentOwner] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [preferenceLocks, setPreferenceLocks] = useState<string[]>([]);
  const preferenceLocked = useCallback((id: string, locked: boolean) => setPreferenceLocks(current => locked ? current.includes(id) ? current : [...current, id] : current.includes(id) ? current.filter(item => item !== id) : current), []);
  useEffect(() => {
    let active = true, revision = 0;
    const db = createClient();
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => { revision++; if (active) { setCurrentOwner(session?.user.id ?? null); setAuthReady(true); } });
    const initial = revision;
    void db.auth.getSession().then(({ data }) => { if (active && revision === initial) { setCurrentOwner(data.session?.user.id ?? null); setAuthReady(true); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [deletionLocked, setDeletionLocked] = useState(false);
  const [mergeLocked, setMergeLocked] = useState(false);
  const [dirtyDrafts, setDirtyDrafts] = useState<string[]>([]);
  const [targets, setTargets] = useState<ConversationTarget[]>([]);
  const [timing, setTiming] = useState<CampaignTiming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const hiddenRecordings = useRef(new Set<string>());
  const [hiddenRecording, setHiddenRecording] = useState<string | null>(null);
  useEffect(() => {
    setPreferenceLocks([]); hiddenRecordings.current.clear(); setHiddenRecording(null);
    setRecordings([]); setSelected(null); setConversations([]); setHistory([]); setDirtyDrafts([]); setTiming(null); setTargets([]); setLoading(false); setError(null);
  }, [currentWorkspaceId, currentOwner]);
  useEffect(() => {
    if (!currentWorkspaceId || !currentOwner) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/field-recordings?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; })
      .then(value => { if (controller.signal.aborted) return; setRecordings(value.recordings.filter((item: Recording) => item.user_id === currentOwner && item.workspace_id === currentWorkspaceId)); setSelected(current => value.recordings.some((recording: Recording) => recording.id === current) ? current : null); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message || 'Unable to load recordings'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentWorkspaceId, currentOwner, refresh]);
  useEffect(() => {
    setConversations([]); setHistory([]); setDirtyDrafts([]); setTiming(null); setTargets([]);
    setHiddenRecording(selected && hiddenRecordings.current.has(selected) ? selected : null);
    if (!selected || !currentOwner || !currentWorkspaceId || hiddenRecordings.current.has(selected)) return;
    const controller = new AbortController();
    setError(null);
    fetch(`/api/field-recordings/${selected}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; })
      .then(value => { if (controller.signal.aborted || hiddenRecordings.current.has(selected)) return; if (value.recording?.id !== selected || value.recording?.user_id !== currentOwner || value.recording?.workspace_id !== currentWorkspaceId) throw new Error('Recording account or workspace changed'); setConversations(value.conversations); setHistory(value.history || []); setTiming(value.timing); setTargets(value.targets || []); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message || 'Unable to load conversations'); });
    return () => controller.abort();
  }, [selected, refresh, currentOwner, currentWorkspaceId]);
  const visibleRecordings = recordings.filter(recording => recording.user_id === currentOwner && recording.workspace_id === currentWorkspaceId);
  const selectedRecording = visibleRecordings.find(recording => recording.id === selected);
  if (!authReady) return <p role="status" className="p-6">Checking recording account…</p>;
  if (!currentOwner) return <p className="p-6">Sign in to review field conversations.</p>;
  return <div className="mx-auto max-w-6xl space-y-6 p-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Field conversations</h1><p className="text-muted-foreground">Recordings, transcripts and conversation insights from your campaign sessions.</p></div><Button variant="outline" disabled={loading || dirtyDrafts.length > 0} title={dirtyDrafts.length ? 'Save draft edits before refreshing' : undefined} onClick={() => setRefresh(value => value + 1)}>Refresh</Button></div>
    {currentWorkspaceId && <DeletionRecovery key={currentWorkspaceId} workspaceId={currentWorkspaceId} excludedRecordingId={selectedRecording?.id ?? null} />}
    {currentWorkspaceId && <PreferenceRecovery key={`${currentOwner}:${currentWorkspaceId}`} ownerId={currentOwner} workspaceId={currentWorkspaceId} visibleSources={selectedRecording && hiddenRecording !== selected ? conversations.map(conversation => ({ recordingId: selectedRecording.id, conversationId: conversation.id })) : []} />}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {loading ? <p role="status">Loading recordings…</p> : !visibleRecordings.length && <Card><CardContent className="p-6">No recordings yet. Connect a PLAUD pin in WolfGrid on your phone to capture a field session.</CardContent></Card>}
    <div className="grid gap-6 md:grid-cols-[320px_1fr]"><div className="space-y-3">{visibleRecordings.map(recording => <button key={recording.id} type="button" aria-pressed={selected === recording.id} onClick={() => setSelected(recording.id)} className={`w-full rounded-xl border p-4 text-left ${selected === recording.id ? 'border-primary bg-muted' : ''}`}><p className="font-medium">{new Date(recording.started_at).toLocaleString()}</p><p className="text-sm">Capture: {recording.capture_state.replaceAll('_', ' ')}</p><p className="text-sm text-muted-foreground">{recording.processing_state.replaceAll('_', ' ')}</p></button>)}</div>
      <div className="space-y-4">{selectedRecording && selected && <RecordingDeletion key={`delete:${selected}`} ownerId={selectedRecording.user_id} workspaceId={selectedRecording.workspace_id} recordingId={selected} dirty={dirtyDrafts.length > 0 || preferenceLocks.length > 0 || mergeLocked} onLocked={setDeletionLocked} onHidden={() => { hiddenRecordings.current.add(selected); setHiddenRecording(selected); setConversations([]); setHistory([]); setDirtyDrafts([]); setTiming(null); setTargets([]); }} />}{selectedRecording && selected && hiddenRecording !== selected && <ConversationMerge key={`merge:${selected}`} ownerId={selectedRecording.user_id} workspaceId={selectedRecording.workspace_id} recordingId={selected} conversations={conversations} dirty={dirtyDrafts.length > 0 || preferenceLocks.length > 0 || deletionLocked} onLocked={setMergeLocked} onMerged={result => {
        if (result.history) setHistory(current => [...current.filter(item => !result.history!.some(original => original.id === item.id)), ...result.history as Conversation[]]);
        setConversations(current => [...current.filter(item => !result.supersededIds.includes(item.id) && !result.conversations.some(child => child.id === item.id)), ...result.conversations as Conversation[]].sort((a, b) => (a.segments[0]?.startMs ?? 0) - (b.segments[0]?.startMs ?? 0)));
        setDirtyDrafts(current => current.filter(id => !result.supersededIds.includes(id)));
      }} />}{selectedRecording && conversations.length > 0 && <CampaignInsights conversations={conversations} targets={targets} />}{selectedRecording && timing && <Card><CardHeader><CardTitle>Campaign door timing</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><p>{timing.doors.length} completed door markers</p><p>{formatDuration(timing.markedDoorMs)} at marked doors</p><p>Average: {timing.averageDoorMs === null ? 'Unavailable' : formatDuration(timing.averageDoorMs)}</p><p>Between doors: {timing.betweenDoorsMs === null ? 'Unavailable' : formatDuration(timing.betweenDoorsMs)}</p></div>
        <p className="text-sm text-muted-foreground">Measured from your door start/finish taps. This is elapsed time, including silence{timing.includesPauses ? ' and campaign pauses' : ''}.</p>
        {(timing.incompleteMarkers > 0 || timing.ambiguousMarkers > 0) && <p className="text-sm text-muted-foreground">{timing.incompleteMarkers} incomplete and {timing.ambiguousMarkers} overlapping markers. Between-door totals are unavailable until these are resolved.</p>}
        <details><summary className="cursor-pointer">Door-by-door times</summary><div className="mt-2 space-y-2">{timing.doors.map((door, index) => <p key={`${door.targetId}:${door.startMs}`} className="text-sm">Door {index + 1}: {formatDuration(door.durationMs)}{door.gapBeforeMs !== null ? ` · ${formatDuration(door.gapBeforeMs)} since previous door` : ''}</p>)}</div></details>
      </CardContent></Card>}{selected && !conversations.length && hiddenRecording !== selected && <p className="text-muted-foreground">Conversations will appear here after transcription and analysis.</p>}<fieldset disabled={mergeLocked || deletionLocked} className="space-y-4">{(selectedRecording ? conversations : []).map(conversation => <Card id={`conversation-${conversation.id}`} key={conversation.id}><CardHeader><CardTitle>{conversation.target_confirmed ? 'Linked door conversation' : 'Door assignment needs review'}</CardTitle><p className="text-sm text-muted-foreground">{conversation.review_state}</p></CardHeader><CardContent className="space-y-3"><ConversationInsights analysis={conversation.analysis} segments={conversation.segments} />{conversation.chunk_id && <RecordingAudio key={`${selected}:${conversation.chunk_id}`} recordingId={selected!} chunkId={conversation.chunk_id} />}<fieldset disabled={preferenceLocks.includes(conversation.id)} className="space-y-3"><ConversationAssignment key={`assignment:${conversation.id}:${conversation.version}`} recordingId={selected!} conversation={conversation} targets={targets} onSaved={updated => setConversations(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))} /><ConversationReview segments={conversation.segments} onDirtyChange={dirty => setDirtyDrafts(current => dirty ? [...new Set([...current, conversation.id])] : current.filter(id => id !== conversation.id))} key={`${conversation.id}:${conversation.version}`} recordingId={selected!} conversation={conversation} onSaved={updated => setConversations(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))} /><ConversationSplit key={`split:${conversation.id}:${conversation.version}`} ownerId={selectedRecording?.user_id ?? ''} workspaceId={selectedRecording?.workspace_id ?? ''} recordingId={selected!} conversation={conversation} dirty={dirtyDrafts.includes(conversation.id)} onSplit={result => {
          if (result.history) setHistory(current => [...current.filter(item => !result.history!.some(original => original.id === item.id)), ...result.history as Conversation[]]);
          setConversations(current => [...current.filter(item => !result.supersededIds.includes(item.id) && !result.conversations.some(child => child.id === item.id)), ...result.conversations as Conversation[]].sort((a, b) => (a.segments[0]?.startMs ?? 0) - (b.segments[0]?.startMs ?? 0)));
          setDirtyDrafts(current => current.filter(id => !result.supersededIds.includes(id)));
        }} /></fieldset><ConversationContactPreference key={`preference:${selected}:${conversation.id}`} ownerId={selectedRecording?.user_id ?? ''} workspaceId={selectedRecording?.workspace_id ?? ''} recordingId={selected!} conversation={conversation} segments={conversation.segments} dirty={dirtyDrafts.includes(conversation.id)} onLocked={preferenceLocked} onSaved={version => setConversations(current => current.map(item => item.id === conversation.id && item.version < version ? { ...item, version } : item))} /><fieldset disabled={preferenceLocks.includes(conversation.id)}><ConversationApplication ownerId={selectedRecording?.user_id ?? ''} workspaceId={selectedRecording?.workspace_id ?? ''} draftDirty={dirtyDrafts.includes(conversation.id)} key={`application:${conversation.id}:${conversation.version}`} recordingId={selected!} conversation={conversation} onSaved={updated => setConversations(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))} /></fieldset><details><summary className="cursor-pointer">Transcript and evidence</summary>{conversation.timing?.clock === 'audio_unaligned' && <p className="mt-2 text-sm text-muted-foreground">Transcript timing alignment is unverified. These transcript timestamps cannot establish the campaign door assignment; review the audio and permission manually.</p>}<div className="mt-3 space-y-2">{conversation.segments.map(segment => <p key={segment.id}><span className="text-sm text-muted-foreground">{Math.floor(segment.startMs / 1000)}s · {segment.speaker || 'Unknown speaker'}: </span>{segment.text}</p>)}</div></details></CardContent></Card>)}</fieldset><ConversationHistory history={selectedRecording ? history : []} /></div>
    </div>
  </div>;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
