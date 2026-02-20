'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Camera, Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/lib/workspace-context';

type BrokerageSuggestion = { id: string; name: string };

const INDUSTRIES = [
  'Real Estate',
  'Solar',
  'Roofing & Exteriors',
  'Financing',
  'Home Health Care',
  'HVAC & Plumbing',
  'Insurance',
  'Landscaping & Snow',
  'Pest Control',
  'Political / Canvassing',
  'Pool Service',
  'Other',
];

function initialsFromName(nameOrEmail: string | null): string {
  const value = (nameOrEmail ?? '').trim();
  if (!value) return 'U';
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export type ProfileEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function ProfileEditDialog({
  open,
  onOpenChange,
  onSaved,
}: ProfileEditDialogProps) {
  const { currentWorkspace, membershipsByWorkspaceId, refreshWorkspaces } =
    useWorkspace();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [industry, setIndustry] = useState('');
  const [brokerageName, setBrokerageName] = useState('');
  const [brokerageId, setBrokerageId] = useState<string | null>(null);
  const [brokerageSuggestions, setBrokerageSuggestions] = useState<BrokerageSuggestion[]>([]);
  const [brokerageSuggestionsOpen, setBrokerageSuggestionsOpen] = useState(false);
  const brokerageQueryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brokerageInputRef = useRef<HTMLInputElement>(null);
  const brokerageListRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceIdForEdit, setWorkspaceIdForEdit] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [isFounder, setIsFounder] = useState(false);

  const fetchBrokerageSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) {
      setBrokerageSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/brokerages/search?q=${encodeURIComponent(q)}&limit=15`,
        { credentials: 'include' }
      );
      const data = await res.json().catch(() => []);
      setBrokerageSuggestions(Array.isArray(data) ? data : []);
    } catch {
      setBrokerageSuggestions([]);
    }
  }, []);

  const currentRole = currentWorkspace
    ? membershipsByWorkspaceId[currentWorkspace.id] ?? null
    : null;
  const isOwner = currentRole === 'owner';
  const canEditWorkspaceName = isOwner || isFounder;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    Promise.all([
      fetch('/api/profile', { credentials: 'include' }).then((res) =>
        res.ok ? res.json() : null
      ),
      fetch('/api/access/state', { credentials: 'include' }).then((res) =>
        res.ok ? res.json() : null
      ),
    ])
      .then(([profileData, accessData]) => {
        if (profileData) {
          setFirstName(profileData.first_name ?? '');
          setLastName(profileData.last_name ?? '');
          setIndustry(profileData.industry ?? '');
          setBrokerageName(profileData.brokerage_name ?? '');
          setQuote(profileData.quote ?? '');
          setAvatarUrl(profileData.avatar_url ?? null);
          setIsFounder(!!profileData.is_founder || !!accessData?.isFounder);
        }
        const fetchedWorkspaceName =
          (typeof accessData?.workspaceName === 'string' &&
            accessData.workspaceName.trim()) ||
          '';
        if (fetchedWorkspaceName) {
          setWorkspaceName(fetchedWorkspaceName);
        } else if (currentWorkspace?.name) {
          setWorkspaceName(currentWorkspace.name);
        } else {
          setWorkspaceName('');
        }

        const fetchedWorkspaceId =
          (typeof accessData?.workspaceId === 'string' &&
            accessData.workspaceId.trim()) ||
          (typeof accessData?.workspace_id === 'string' &&
            accessData.workspace_id.trim()) ||
          currentWorkspace?.id ||
          null;
        setWorkspaceIdForEdit(fetchedWorkspaceId);
      })
      .catch(() => setError('Failed to load profile'))
      .finally(() => setLoading(false));
  }, [open, currentWorkspace?.id, currentWorkspace?.name]);

  useEffect(() => {
    if (open && currentWorkspace) {
      setWorkspaceName(currentWorkspace.name ?? '');
      setWorkspaceIdForEdit(currentWorkspace.id ?? null);
    }
  }, [open, currentWorkspace?.id, currentWorkspace?.name]);

  // Brokerage typeahead: only when industry is Real Estate, debounced fetch
  useEffect(() => {
    if (industry !== 'Real Estate') return;
    const value = brokerageName.trim();
    if (brokerageQueryTimeout.current) clearTimeout(brokerageQueryTimeout.current);
    if (!value) {
      setBrokerageSuggestions([]);
      setBrokerageSuggestionsOpen(false);
      return;
    }
    brokerageQueryTimeout.current = setTimeout(() => {
      fetchBrokerageSuggestions(value);
      setBrokerageSuggestionsOpen(true);
      brokerageQueryTimeout.current = null;
    }, 200);
    return () => {
      if (brokerageQueryTimeout.current) clearTimeout(brokerageQueryTimeout.current);
    };
  }, [industry, brokerageName, fetchBrokerageSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        brokerageSuggestionsOpen &&
        brokerageInputRef.current &&
        brokerageListRef.current &&
        !brokerageInputRef.current.contains(e.target as Node) &&
        !brokerageListRef.current.contains(e.target as Node)
      ) {
        setBrokerageSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [brokerageSuggestionsOpen]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Failed to upload photo');
        return;
      }
      if (data.url) setAvatarUrl(data.url);
    } catch {
      setError('Failed to upload photo');
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const normalizedWorkspaceName = workspaceName.trim().replace(/\s+/g, ' ').trim();
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          industry: industry.trim() || null,
          brokerage_name: brokerageName.trim() || null,
          quote: quote.trim().slice(0, 500) || null,
          avatar_url: avatarUrl || null,
          workspace_name:
            canEditWorkspaceName && normalizedWorkspaceName
              ? normalizedWorkspaceName
              : undefined,
          workspace_id:
            canEditWorkspaceName && workspaceIdForEdit
              ? workspaceIdForEdit
              : undefined,
        }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Failed to update profile');
        return;
      }

      await refreshWorkspaces();
      onSaved?.();
      onOpenChange(false);
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Profile';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update your photo, name, industry, and quote. Team owners can change the workspace name.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted text-2xl font-semibold text-foreground ring-offset-background transition hover:opacity-90 disabled:opacity-50"
                aria-label="Change profile photo"
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span>
                    {initialsFromName(displayName)}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition hover:opacity-100">
                  <Camera className="h-8 w-8 text-white" />
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={handleAvatarChange}
              />
              <span className="text-muted-foreground text-xs">
                {uploadingAvatar ? 'Uploading…' : 'Click to change photo'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-first-name">First name</Label>
                <Input
                  id="profile-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-last-name">Last name</Label>
                <Input
                  id="profile-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-industry">Industry</Label>
              <Select
                value={industry || undefined}
                onValueChange={(value) => {
                  setIndustry(value);
                  if (value !== 'Real Estate') {
                    setBrokerageName('');
                    setBrokerageId(null);
                    setBrokerageSuggestions([]);
                    setBrokerageSuggestionsOpen(false);
                  }
                }}
              >
                <SelectTrigger id="profile-industry" className="w-full">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {industry === 'Real Estate' && (
              <div className="grid gap-2 relative" ref={brokerageListRef}>
                <Label htmlFor="profile-brokerage">Brokerage (if applicable)</Label>
                <Input
                  ref={brokerageInputRef}
                  id="profile-brokerage"
                  value={brokerageName}
                  onChange={(e) => {
                    setBrokerageName(e.target.value);
                    setBrokerageId(null);
                  }}
                  onFocus={() => brokerageName.trim() && setBrokerageSuggestionsOpen(true)}
                  placeholder="Search brokerage..."
                  autoComplete="off"
                />
                {brokerageSuggestionsOpen && brokerageName.trim() && (
                  <div
                    className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-72 overflow-auto py-1"
                    role="listbox"
                  >
                    {brokerageSuggestions.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        role="option"
                        className="w-full px-4 py-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-3"
                        onClick={() => {
                          setBrokerageName(b.name);
                          setBrokerageId(b.id);
                          setBrokerageSuggestionsOpen(false);
                          setBrokerageSuggestions([]);
                        }}
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span>{b.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">Existing</span>
                      </button>
                    ))}
                    {brokerageName.trim() &&
                      !brokerageSuggestions.some(
                        (b) => b.name.toLowerCase() === brokerageName.trim().toLowerCase()
                      ) && (
                        <button
                          type="button"
                          role="option"
                          className="w-full px-4 py-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-3 border-t border-border mt-1 pt-2"
                          onClick={() => {
                            const value = brokerageName.trim().replace(/\s+/g, ' ');
                            setBrokerageName(value);
                            setBrokerageId(null);
                            setBrokerageSuggestionsOpen(false);
                            setBrokerageSuggestions([]);
                          }}
                        >
                          <Plus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <span className="text-muted-foreground">
                            Add &quot;{brokerageName.trim()}&quot; as new brokerage
                          </span>
                        </button>
                      )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="profile-quote">Quote</Label>
              <Textarea
                id="profile-quote"
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="A short quote or tagline"
                rows={3}
                maxLength={500}
                className="resize-none"
              />
              <span className="text-muted-foreground text-xs">
                {quote.length}/500
              </span>
            </div>

            {canEditWorkspaceName && (
              <div className="grid gap-2 border-t pt-4">
                <Label htmlFor="profile-workspace-name">Workspace name</Label>
                <Input
                  id="profile-workspace-name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Workspace name"
                />
                <p className="text-muted-foreground text-xs">
                  Workspace owners and founders can change the workspace name.
                </p>
              </div>
            )}
          </div>
        )}

        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
