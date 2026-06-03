'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, Plus, Search, Trash2 } from 'lucide-react';
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
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
  return (
    <li className="group">
      <div
        className={cn(
          'flex items-center gap-1 border-l-2 px-3 py-2 text-sm transition-colors -ml-px',
          selected
            ? 'border-primary bg-primary/10 font-medium text-foreground dark:bg-primary/15'
            : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/30'
        )}
      >
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 flex-1 truncate">{list.name}</span>
          <Badge variant="outline" className="h-5 shrink-0 rounded-full px-1.5 py-0 text-[10px]">
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
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
  collapsed = false,
  onToggleCollapse,
  width = 280,
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

  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-[49px] items-center justify-center border-r border-b border-border">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Show list"
          title="Show list"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside
        className="shrink-0 flex max-h-[42vh] w-full flex-col overflow-hidden border-b border-border bg-white transition-[width] duration-200 ease-out dark:bg-sidebar lg:h-full lg:max-h-none lg:border-b-0 lg:border-r"
        style={{ width }}
      >
        <div className="border-b border-border p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">LIST</p>
            <button
              onClick={onToggleCollapse}
              className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 ml-auto"
              aria-label="Hide list"
              title="Hide list"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            {canManageCustomLists ? (
              <Button
                size="icon"
                className="h-8 w-8 shrink-0 rounded-md bg-red-600 text-white hover:bg-red-700"
                onClick={() => setDialogOpen(true)}
                aria-label="Create list"
                disabled={busy}
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search lists..."
              className="h-8 bg-background pl-8 text-xs"
            />
          </div>
        </div>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2 py-2">
          {overviewLists.length > 0 ? (
            <section>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Overview
              </p>
              <ul>
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
            <div className="mb-1 flex items-center justify-between px-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Imported & Saved</p>
              <span className="text-xs text-muted-foreground">{customLists.length}</span>
            </div>
            {filteredCustomLists.length === 0 ? (
              <div className="mx-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                {canManageCustomLists
                  ? copy.leads.importedSavedEmptyManage
                  : copy.leads.importedSavedEmpty}
              </div>
            ) : (
              <ul>
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
              <div className="mb-1 flex items-center justify-between px-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.nouns.campaignPlural}
                </p>
                <span className="text-xs text-muted-foreground">{campaignLists.length}</span>
              </div>
              <ul>
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
              <div className="mb-1 flex items-center justify-between px-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.nouns.farmPlural}
                </p>
                <span className="text-xs text-muted-foreground">{farmLists.length}</span>
              </div>
              <ul>
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
              <div className="mx-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
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
