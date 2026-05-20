'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, MapPinned, Megaphone, Plus, Search, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
import { getIndustryCopy, type IndustryCopy } from '@/lib/industry-copy';
import type { SmartListBaseKind, SmartListCriteria } from '@/types/smart-lists';
import type { SmartListOption } from './smart-list-utils';

type SmartListSidebarItem = SmartListOption & {
  count: number;
};

interface SmartListSidebarProps {
  builtInLists: SmartListSidebarItem[];
  customLists: SmartListSidebarItem[];
  selectedListId: string;
  onSelectList: (listId: string) => void;
  onCreateList: (list: {
    name: string;
    criteria: SmartListCriteria;
  }) => Promise<boolean>;
  onDeleteList: (listId: string) => Promise<void>;
  canManageCustomLists?: boolean;
  busy?: boolean;
  copy?: IndustryCopy;
}

function smartListIcon(kind: SmartListOption['kind']) {
  switch (kind) {
    case 'campaign':
      return Megaphone;
    case 'farm':
      return MapPinned;
    case 'networking':
      return Users;
    case 'custom':
    case 'all':
    default:
      return ListFilter;
  }
}

function SmartListRow({
  list,
  selected,
  onSelect,
  onDelete,
}: {
  list: SmartListSidebarItem;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const Icon = smartListIcon(list.kind);

  return (
    <li className="group">
      <div
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
          selected
            ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
            : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground'
        )}
      >
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
              selected ? 'border-primary/30 bg-primary/15 text-primary' : 'border-border bg-background text-muted-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{list.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{list.description}</span>
          </span>
          <Badge variant="outline" className="shrink-0 rounded-full px-2 py-0 text-[11px]">
            {list.count}
          </Badge>
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete ${list.name}`}
            title={`Delete ${list.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function SmartListSidebar({
  builtInLists,
  customLists,
  selectedListId,
  onSelectList,
  onCreateList,
  onDeleteList,
  canManageCustomLists = true,
  busy = false,
  copy: industryCopy,
}: SmartListSidebarProps) {
  const copy = industryCopy ?? getIndustryCopy(null);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseKind, setBaseKind] = useState<SmartListBaseKind>('custom');
  const [source, setSource] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => handleWheelScrollContainer(event, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const query = search.trim().toLowerCase();
  const matchesQuery = useCallback((list: SmartListSidebarItem) => {
    if (!query) return true;
    const haystack = `${list.name} ${list.description}`.toLowerCase();
    return haystack.includes(query);
  }, [query]);

  const overviewLists = useMemo(
    () => builtInLists.filter((list) => list.kind === 'all').filter(matchesQuery),
    [builtInLists, matchesQuery]
  );

  const campaignLists = useMemo(
    () => builtInLists.filter((list) => list.kind === 'campaign').filter(matchesQuery),
    [builtInLists, matchesQuery]
  );

  const farmLists = useMemo(
    () => builtInLists.filter((list) => list.kind === 'farm').filter(matchesQuery),
    [builtInLists, matchesQuery]
  );

  const filteredCustomLists = useMemo(
    () => customLists.filter(matchesQuery),
    [customLists, matchesQuery]
  );

  const resetForm = () => {
    setName('');
    setBaseKind('custom');
    setSource('');
    setTags('');
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSubmitting(true);
    try {
      const created = await onCreateList({
        name: trimmedName,
        criteria: {
          baseKind,
          source: source.trim(),
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      });

      if (created) {
        resetForm();
        setDialogOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <aside className="w-full shrink-0 overflow-hidden rounded-2xl border border-border bg-card lg:w-[310px]">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Lists</p>
              <p className="text-xs text-muted-foreground">
                Browse {copy.nouns.leadPlural} from imports, {copy.nouns.campaignPlural}, {copy.nouns.farmPlural}, and saved views.
              </p>
            </div>
            {canManageCustomLists ? (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg bg-red-600 text-white hover:bg-red-700"
                onClick={() => setDialogOpen(true)}
                aria-label="Create list"
                disabled={busy}
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search smart lists..."
              className="pl-9"
            />
          </div>
        </div>

        <div ref={scrollContainerRef} className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
          {overviewLists.length > 0 ? (
            <section>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Overview
              </p>
              <ul className="space-y-2">
                {overviewLists.map((list) => (
                  <SmartListRow
                    key={list.id}
                    list={list}
                    selected={selectedListId === list.id}
                    onSelect={() => onSelectList(list.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Imported & Saved</p>
              <span className="text-xs text-muted-foreground">{customLists.length}</span>
            </div>
            {filteredCustomLists.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
                {canManageCustomLists
                  ? copy.leads.importedSavedEmptyManage
                  : copy.leads.importedSavedEmpty}
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredCustomLists.map((list) => (
                  <SmartListRow
                    key={list.id}
                    list={list}
                    selected={selectedListId === list.id}
                    onSelect={() => onSelectList(list.id)}
                    onDelete={() => onDeleteList(list.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          {campaignLists.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.nouns.campaignPlural}
                </p>
                <span className="text-xs text-muted-foreground">{campaignLists.length}</span>
              </div>
              <ul className="space-y-2">
                {campaignLists.map((list) => (
                  <SmartListRow
                    key={list.id}
                    list={list}
                    selected={selectedListId === list.id}
                    onSelect={() => onSelectList(list.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {farmLists.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.nouns.farmPlural}
                </p>
                <span className="text-xs text-muted-foreground">{farmLists.length}</span>
              </div>
              <ul className="space-y-2">
                {farmLists.map((list) => (
                  <SmartListRow
                    key={list.id}
                    list={list}
                    selected={selectedListId === list.id}
                    onSelect={() => onSelectList(list.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {query && overviewLists.length === 0 && filteredCustomLists.length === 0 && campaignLists.length === 0 && farmLists.length === 0 ? (
            <section>
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
                No lists match your search yet.
              </div>
            </section>
          ) : null}
        </div>
      </aside>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Saved List</DialogTitle>
            <DialogDescription>
              {copy.leads.newSavedListDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="smart-list-name" className="text-sm font-medium text-foreground">
                List name
              </label>
              <Input
                id="smart-list-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.leads.listNamePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{copy.leads.baseKindLabel}</label>
              <Select value={baseKind} onValueChange={(value) => setBaseKind(value as SmartListBaseKind)}>
                <SelectTrigger>
                  <SelectValue placeholder={copy.leads.baseKindPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="campaign">{copy.nouns.campaign}</SelectItem>
                  <SelectItem value="farm">{copy.nouns.farm}</SelectItem>
                  <SelectItem value="networking">Networking</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="smart-list-source" className="text-sm font-medium text-foreground">
                Source contains
              </label>
              <Input
                id="smart-list-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={copy.leads.sourcePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="smart-list-tags" className="text-sm font-medium text-foreground">
                Tags
              </label>
              <Input
                id="smart-list-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={copy.leads.tagsPlaceholder}
              />
              <p className="text-xs text-muted-foreground">Separate multiple tags with commas.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim() || submitting}>
              {submitting ? 'Saving...' : 'Save List'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
