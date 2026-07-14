'use client';

import { type CSSProperties, FormEvent, useMemo, useState } from 'react';
import type { DemoPayload, DemoVertical } from '@/lib/demo/payload';

const VERTICALS: DemoVertical[] = ['roofing', 'lawncare', 'hvac', 'solar', 'political', 'real_estate', 'generic'];
const CTA_VARIANTS: DemoPayload['ctaVariant'][] = ['a', 'b'];

type FormState = {
  company: string;
  vertical: DemoVertical;
  city: string;
  ctaVariant: DemoPayload['ctaVariant'];
  ctaUrl: string;
  slug: string;
};

type CreateResult = {
  slug: string;
  url: string;
  center: [number, number];
};

const initialForm: FormState = {
  company: '',
  vertical: 'roofing',
  city: '',
  ctaVariant: 'a',
  ctaUrl: '',
  slug: '',
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function NewDemoLinkPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const suggestedSlug = useMemo(() => slugify(form.company), [form.company]);

  const setField = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch('/api/demo-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: form.company,
          vertical: form.vertical,
          city: form.city,
          ctaVariant: form.ctaVariant,
          ctaUrl: form.ctaUrl,
          slug: form.slug,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      setResult(body as CreateResult);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create demo link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyUrl = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
  };

  const reset = () => {
    setForm(initialForm);
    setResult(null);
    setError(null);
    setCopied(false);
  };

  return (
    <main style={styles.page}>
      <section style={styles.panel} aria-labelledby="demo-admin-title">
        <div style={styles.eyebrow}>WolfGrid · DEMO ADMIN</div>
        <h1 id="demo-admin-title" style={styles.title}>
          Create demo link
        </h1>

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            Company
            <input
              required
              value={form.company}
              onChange={(event) => setField('company', event.target.value)}
              style={styles.input}
              autoComplete="organization"
            />
          </label>

          <label style={styles.label}>
            Vertical
            <select
              value={form.vertical}
              onChange={(event) => setField('vertical', event.target.value as DemoVertical)}
              style={styles.input}
            >
              {VERTICALS.map((vertical) => (
                <option key={vertical} value={vertical}>
                  {vertical}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            City
            <input
              required
              value={form.city}
              onChange={(event) => setField('city', event.target.value)}
              style={styles.input}
              placeholder="Oshawa"
              autoComplete="address-level2"
            />
          </label>

          <label style={styles.label}>
            CTA variant
            <select
              value={form.ctaVariant}
              onChange={(event) => setField('ctaVariant', event.target.value as DemoPayload['ctaVariant'])}
              style={styles.input}
            >
              {CTA_VARIANTS.map((variant) => (
                <option key={variant} value={variant}>
                  {variant}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            CTA URL or email
            <input
              value={form.ctaUrl}
              onChange={(event) => setField('ctaUrl', event.target.value)}
              style={styles.input}
              inputMode="url"
            />
          </label>

          <label style={styles.label}>
            Slug
            <input
              value={form.slug}
              onChange={(event) => setField('slug', event.target.value)}
              style={styles.input}
              placeholder={suggestedSlug || 'auto-generated'}
            />
          </label>

          {error ? <p style={styles.error}>{error}</p> : null}

          <button type="submit" disabled={isSubmitting} style={styles.primaryButton}>
            {isSubmitting ? 'Creating...' : 'Create link'}
          </button>
        </form>

        {result ? (
          <div style={styles.result}>
            <div style={styles.resultLabel}>Generated URL</div>
            <a href={result.url} target="_blank" rel="noreferrer" style={styles.resultUrl}>
              {result.url}
            </a>
            <div style={styles.actions}>
              <button type="button" onClick={copyUrl} style={styles.secondaryButton}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a href={result.url} target="_blank" rel="noreferrer" style={styles.linkButton}>
                Preview
              </a>
              <button type="button" onClick={reset} style={styles.secondaryButton}>
                Create another
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const hardBorder = '1px solid rgba(217,213,203,.26)';

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    padding: '8dvh 6vw',
    background: 'var(--ink)',
    color: 'var(--paper)',
  },
  panel: {
    width: 'min(760px, 100%)',
    margin: '0 auto',
  },
  eyebrow: {
    color: 'var(--orange)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '.22em',
    marginBottom: 18,
  },
  title: {
    margin: 0,
    marginBottom: 32,
    fontFamily: 'var(--disp)',
    fontSize: 'clamp(42px, 9vw, 96px)',
    fontWeight: 900,
    fontStretch: '73%',
    textTransform: 'uppercase',
    lineHeight: .9,
  },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 18,
  },
  label: {
    display: 'grid',
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 48,
    border: hardBorder,
    borderRadius: 0,
    background: 'transparent',
    color: 'var(--paper)',
    font: 'inherit',
    letterSpacing: 0,
    padding: '12px 14px',
    outlineColor: 'var(--orange)',
  },
  error: {
    gridColumn: '1 / -1',
    margin: 0,
    border: '1px solid var(--red)',
    color: 'var(--red)',
    padding: 14,
  },
  primaryButton: {
    minHeight: 50,
    gridColumn: '1 / -1',
    border: '1px solid var(--orange)',
    borderRadius: 0,
    background: 'var(--orange)',
    color: 'var(--ink)',
    font: 'inherit',
    fontWeight: 700,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
  result: {
    marginTop: 32,
    border: '1px solid var(--orange)',
    padding: 20,
  },
  resultLabel: {
    color: 'var(--orange)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  resultUrl: {
    color: 'var(--paper)',
    fontSize: 'clamp(18px, 4vw, 28px)',
    overflowWrap: 'anywhere',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 18,
  },
  secondaryButton: {
    minHeight: 44,
    border: hardBorder,
    borderRadius: 0,
    background: 'transparent',
    color: 'var(--paper)',
    font: 'inherit',
    padding: '10px 14px',
    cursor: 'pointer',
  },
  linkButton: {
    minHeight: 44,
    border: hardBorder,
    color: 'var(--paper)',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '10px 14px',
    textDecoration: 'none',
  },
};
