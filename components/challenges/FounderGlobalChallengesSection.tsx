'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Archive, CheckCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { templateTimeframeLabel } from '@/lib/challenges/timeframe';
import type { ChallengeTemplate, ChallengeTemplateStatus } from '@/types/challenges';

export function FounderGlobalChallengesSection() {
  const [templates, setTemplates] = useState<ChallengeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChallengeTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/challenges', { credentials: 'include' });
      const json = (await res.json().catch(() => null)) as { templates?: ChallengeTemplate[]; error?: string };
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load');
      setTemplates(json.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (t: ChallengeTemplate) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const patchTemplate = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/challenges/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: string };
    if (!res.ok) throw new Error(json?.error ?? 'Save failed');
    return json;
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await patchTemplate(editing.id, {
        title: editing.title,
        description: editing.description,
        status: editing.templateStatus,
        duration_days: editing.durationDays ?? undefined,
        metric_label_override: editing.metricLabelOverride,
        target_audience: editing.targetAudience,
      });
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const archive = async (id: string) => {
    try {
      await patchTemplate(id, { status: 'archived' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    }
  };

  const markCompleted = async (id: string) => {
    try {
      await patchTemplate(id, { status: 'completed' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) => {
        const order: ChallengeTemplateStatus[] = ['active', 'upcoming', 'completed', 'archived'];
        const ar = order.indexOf(a.templateStatus);
        const br = order.indexOf(b.templateStatus);
        return (ar === -1 ? 99 : ar) - (br === -1 ? 99 : br) || a.title.localeCompare(b.title);
      }),
    [templates]
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading global challenges…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">Global challenges</CardTitle>
          <CardDescription>
            Live data from <code className="text-xs">challenge_templates</code>. Scores come from session
            activity. New challenges can be added via migration or future admin tools.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No challenge templates in the database yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((t) => (
              <li
                key={t.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="font-medium text-sm truncate">{t.title}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{t.slug ?? t.id}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{t.description}</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {t.type === 'rolling_onboarding' ? 'Rolling' : 'Fixed dates'}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {t.templateStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{templateTimeframeLabel(t)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void markCompleted(t.id)}>
                    <CheckCircle className="size-3.5" />
                    Complete
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void archive(t.id)}>
                    <Archive className="size-3.5" />
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit global challenge</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              {editing.type === 'rolling_onboarding' ? (
                <div className="space-y-2">
                  <Label>Duration (days per user)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={editing.durationDays ?? 30}
                    onChange={(e) =>
                      setEditing({ ...editing, durationDays: Number(e.target.value) || 30 })
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Catalog status</Label>
                <Select
                  value={editing.templateStatus}
                  onValueChange={(v) =>
                    setEditing({ ...editing, templateStatus: v as ChallengeTemplateStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target audience</Label>
                <Input
                  value={editing.targetAudience ?? ''}
                  onChange={(e) => setEditing({ ...editing, targetAudience: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Metric label override</Label>
                <Input
                  value={editing.metricLabelOverride ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, metricLabelOverride: e.target.value || null })
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !editing} onClick={() => void saveEdit()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
