import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listPromptTemplates } from '../src/prompt-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const promptTemplatesRoot = path.join(repoRoot, 'prompt-templates');

interface PromptTemplateForTest {
  id: string;
  surface: string;
  title: string;
  category: string;
  model?: string;
  previewImageUrl?: string;
  prompt: string;
  localizedPrompts?: Record<string, string>;
  source: {
    repo: string;
    license: string;
  };
}

const KOREAN_STYLE_TEMPLATE_IDS = [
  'k-editorial-magazine-cover',
  'minimal-product-poster-korean-brand',
  'friendly-character-illustration-kakao-style',
  'luxury-cosmetic-campaign-visual',
  'webtoon-key-visual-poster',
  'k-food-menu-poster',
  'startup-pitch-hero-visual',
  'architecture-mood-render-korea',
  'dopamine-3d-cyclist-wheelie-character',
] as const;

const IMAGE2_HUB_TEMPLATE_PREFIX = 'image2hub-';
const HAN_SCRIPT_RE = /[\u3400-\u9fff]/;

const PREVIEW_EXTENSION_BY_ID: Partial<Record<(typeof KOREAN_STYLE_TEMPLATE_IDS)[number], string>> = {
  'dopamine-3d-cyclist-wheelie-character': 'png',
};

describe('prompt template registry', () => {
  it('includes the curated Korean-friendly image style templates', async () => {
    const templates = await listPromptTemplates(promptTemplatesRoot) as PromptTemplateForTest[];
    const byId = new Map(templates.map((template) => [template.id, template]));

    for (const id of KOREAN_STYLE_TEMPLATE_IDS) {
      const template = byId.get(id);
      expect(template, id).toBeTruthy();
      if (!template) throw new Error(`Missing prompt template ${id}`);
      expect(template).toMatchObject({
        id,
        surface: 'image',
        model: 'gpt-image-2',
      });
      expect(template.prompt.length, `${id} prompt length`).toBeGreaterThan(200);
      expect(
        template.localizedPrompts?.ko?.length ?? 0,
        `${id} Korean prompt length`,
      ).toBeGreaterThan(100);
      const previewExtension = PREVIEW_EXTENSION_BY_ID[id] ?? 'svg';
      expect(template.previewImageUrl, `${id} preview`).toBe(
        `/prompt-template-previews/image/${id}.${previewExtension}`,
      );
      expect(template.source.repo, `${id} source repo`).toBe('nexu-io/open-design');
      expect(template.source.license, `${id} source license`).toBe('Apache-2.0');
    }
  });

  it('imports Image2 Hub image styles with Korean-ready display metadata', async () => {
    const templates = await listPromptTemplates(promptTemplatesRoot) as PromptTemplateForTest[];
    const image2HubTemplates = templates.filter((template) =>
      template.id.startsWith(IMAGE2_HUB_TEMPLATE_PREFIX),
    );

    expect(image2HubTemplates.length).toBeGreaterThanOrEqual(80);

    for (const template of image2HubTemplates) {
      expect(template.surface, template.id).toBe('image');
      expect(template.model, template.id).toBe('gpt-image-2');
      expect(template.previewImageUrl, template.id).toMatch(
        /^https:\/\/image2hub\.netlify\.app\/assets\//,
      );
      expect(template.source.repo, template.id).toBe('houshifang/image');
      expect(template.title, template.id).not.toMatch(HAN_SCRIPT_RE);
      expect(template.category, template.id).not.toMatch(HAN_SCRIPT_RE);
      expect(template.prompt, template.id).not.toMatch(/\bChinese\b|中文|汉字|漢字/i);
    }
  });
});
