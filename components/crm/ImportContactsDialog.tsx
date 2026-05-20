'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SmartListsService } from '@/lib/services/SmartListsService';
import { getIndustryCopy, type IndustryCopy } from '@/lib/industry-copy';

type ImportContactsDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (result?: ImportResult) => void;
  workspaceId?: string;
  copy?: IndustryCopy;
};

type ImportResult = {
  imported: number;
  skipped: number;
  message: string;
  skippedRows?: string[];
  createdListId?: string | null;
  createdListName?: string | null;
  requestedListName?: string | null;
  importedContactIds?: string[];
};

export function ImportContactsDialog({
  open,
  onClose,
  onSuccess,
  workspaceId,
  copy: industryCopy,
}: ImportContactsDialogProps) {
  const copy = industryCopy ?? getIndustryCopy(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [listName, setListName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const acceptedColumns = useMemo(
    () => [
      'name or full_name',
      'first_name / last_name',
      'phone',
      'email',
      'address',
      'status',
      'campaign_id',
      'farm_id',
      'source',
      'tags',
      'last_contacted',
      'notes',
      'follow_up_at',
      'appointment_at',
    ],
    []
  );

  const resetState = () => {
    setFile(null);
    setListName('');
    setResult(null);
    setErrorMessage(null);
    setLoading(false);
  };

  const handleClose = () => {
    if (loading) return;
    resetState();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setErrorMessage('Choose a CSV file first.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (workspaceId) {
        formData.append('workspaceId', workspaceId);
      }
      if (listName.trim()) {
        formData.append('listName', listName.trim());
      }

      const response = await fetch('/api/leads/import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        imported?: number;
        skipped?: number;
        message?: string;
        skippedRows?: string[];
        createdListId?: string | null;
        createdListName?: string | null;
        requestedListName?: string | null;
        importedContactIds?: string[];
      };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import CSV');
      }

      let nextResult: ImportResult = {
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        message: data.message ?? 'CSV import complete.',
        skippedRows: data.skippedRows ?? [],
        createdListId: data.createdListId ?? null,
        createdListName: data.createdListName ?? null,
        requestedListName: data.requestedListName ?? null,
        importedContactIds: Array.isArray(data.importedContactIds) ? data.importedContactIds : [],
      };

      if (
        !nextResult.createdListId &&
        workspaceId &&
        nextResult.requestedListName &&
        (nextResult.importedContactIds?.length ?? 0) > 0
      ) {
        const localList = SmartListsService.createLocalWorkspaceSmartList({
          workspaceId,
          name: nextResult.requestedListName,
          criteria: {
            baseKind: 'custom',
            source: '',
            tags: [],
            campaignIds: [],
            farmIds: [],
            contactIds: nextResult.importedContactIds ?? [],
          },
        });

        nextResult = {
          ...nextResult,
          createdListId: localList.id,
          createdListName: localList.name,
          message: `Imported ${nextResult.imported} lead${nextResult.imported === 1 ? '' : 's'}. Created the "${localList.name}" list on this device.`,
        };
      }

      setResult(nextResult);
      onSuccess(nextResult);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to import CSV');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{copy.importDialog.title}</DialogTitle>
          <DialogDescription>{copy.importDialog.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lead-import-file">CSV File</Label>
            <Input
              id="lead-import-file"
              type="file"
              accept=".csv,text/csv"
              disabled={loading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-import-list-name">Create List</Label>
            <Input
              id="lead-import-list-name"
              value={listName}
              onChange={(event) => setListName(event.target.value)}
              placeholder={copy.importDialog.listNamePlaceholder}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              {copy.importDialog.helper}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Accepted columns</div>
            <div className="mt-2">
              {acceptedColumns.join(', ')}
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
              <div>{result.message}</div>
              <div className="mt-1">
                Imported: {result.imported} | Skipped: {result.skipped}
              </div>
              {result.skippedRows && result.skippedRows.length > 0 && (
                <div className="mt-2 text-xs">
                  {result.skippedRows.join(' | ')}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Close
            </Button>
            <Button type="submit" disabled={loading || !file}>
              {loading ? 'Importing...' : 'Import CSV'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
