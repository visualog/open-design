// Prompt template registry. Mirrors design-systems.js: scans
// <projectRoot>/prompt-templates/{image,video}/*.json on every list call
// and returns the parsed entries with light validation.
//
// Each JSON file is hand-curated (or imported via
// scripts/import-prompt-templates.mjs) and carries a `source` block so
// attribution stays intact when we surface the entry in the gallery and
// the system prompt.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_SURFACES = ['image', 'video'] as const;
type PromptTemplateSurface = (typeof SUPPORTED_SURFACES)[number];
type JsonRecord = Record<string, unknown>;

interface PromptTemplate {
  id: string;
  surface: PromptTemplateSurface;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  model?: string;
  aspect?: string;
  prompt: string;
  localizedPrompts?: Record<string, string>;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  importedAt?: string;
  source: { repo: string; license: string; author?: string; url?: string };
}

type PromptTemplateRootInput = string | readonly string[];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object';
}

export async function listPromptTemplates(rootInput: PromptTemplateRootInput): Promise<PromptTemplate[]> {
  const out = new Map<string, PromptTemplate>();
  const roots = normalizeRoots(rootInput);
  for (const surface of SUPPORTED_SURFACES) {
    for (const root of roots) {
      const dir = path.join(root, surface);
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.json')) continue;
        const filePath = path.join(dir, entry.name);
        try {
          const stats = await stat(filePath);
          if (!stats.isFile()) continue;
          const raw = await readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          const validated = validateTemplate(parsed, surface, entry.name);
          if (validated && !out.has(templateKey(validated))) out.set(templateKey(validated), validated);
        } catch (err) {
          console.warn(`prompt-templates: failed ${filePath}`, err);
        }
      }
    }
  }
  // Stable order — same surface group together, alpha by title within
  // surface so the gallery matches what `ls` would suggest.
  const templates = [...out.values()];
  templates.sort((a, b) => {
    if (a.surface !== b.surface) {
      return a.surface === 'image' ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
  return templates;
}

export async function readPromptTemplate(rootInput: PromptTemplateRootInput, surface: string, id: string): Promise<PromptTemplate | null> {
  if (!isPromptTemplateSurface(surface)) return null;
  for (const root of normalizeRoots(rootInput)) {
    const filePath = path.join(root, surface, `${id}.json`);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const validated = validateTemplate(parsed, surface, `${id}.json`);
      if (validated) return validated;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeRoots(rootInput: PromptTemplateRootInput): string[] {
  const roots = Array.isArray(rootInput) ? rootInput : [rootInput];
  return roots.filter((root) => typeof root === 'string' && root.length > 0);
}

function templateKey(template: PromptTemplate): string {
  return `${template.surface}:${template.id}`;
}

function isPromptTemplateSurface(surface: string): surface is PromptTemplateSurface {
  return (SUPPORTED_SURFACES as readonly string[]).includes(surface);
}

function validateTemplate(raw: unknown, expectedSurface: PromptTemplateSurface, fileName: string): PromptTemplate | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) {
    console.warn(`prompt-templates: ${fileName} missing id`);
    return null;
  }
  if (raw.surface !== expectedSurface) {
    console.warn(
      `prompt-templates: ${fileName} surface=${raw.surface} ≠ folder=${expectedSurface}`,
    );
    return null;
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
  if (typeof raw.prompt !== 'string' || raw.prompt.trim().length < 20) {
    console.warn(`prompt-templates: ${fileName} prompt too short`);
    return null;
  }
  const source = isRecord(raw.source) ? raw.source : null;
  const sourceRepo = source && typeof source.repo === 'string' ? source.repo : 'local';
  const sourceLicense = source && typeof source.license === 'string' ? source.license : 'unspecified';
  const localizedPrompts =
    raw.localizedPrompts && typeof raw.localizedPrompts === 'object'
      ? Object.fromEntries(
          Object.entries(raw.localizedPrompts)
            .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
            .map(([key, value]) => [key, value.trim()]),
        )
      : null;
  const template: PromptTemplate = {
    id: raw.id,
    surface: expectedSurface,
    title: raw.title.trim(),
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    category: typeof raw.category === 'string' ? raw.category : 'General',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    prompt: raw.prompt.trim(),
    ...(localizedPrompts ? { localizedPrompts } : {}),
    ...(typeof raw.previewImageUrl === 'string' ? { previewImageUrl: raw.previewImageUrl } : {}),
    ...(typeof raw.previewVideoUrl === 'string' ? { previewVideoUrl: raw.previewVideoUrl } : {}),
    ...(typeof raw.importedAt === 'string' ? { importedAt: raw.importedAt } : {}),
    source: {
      repo: sourceRepo,
      license: sourceLicense,
    },
  };
  if (typeof raw.model === 'string') template.model = raw.model;
  if (typeof raw.aspect === 'string') template.aspect = raw.aspect;
  if (typeof raw.previewImageUrl === 'string') template.previewImageUrl = raw.previewImageUrl;
  if (typeof raw.previewVideoUrl === 'string') template.previewVideoUrl = raw.previewVideoUrl;
  if (typeof raw.importedAt === 'string') template.importedAt = raw.importedAt;
  if (source && typeof source.author === 'string') template.source.author = source.author;
  if (source && typeof source.url === 'string') template.source.url = source.url;
  return template;
}
