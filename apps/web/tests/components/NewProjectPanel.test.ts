import { describe, expect, it } from 'vitest';

import { getPromptTemplatePickerItems } from '../../src/components/NewProjectPanel';
import type { PromptTemplateSummary } from '../../src/types';
import { supportedModels } from '../../src/components/NewProjectPanel';
import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS } from '../../src/media/models';

const templates: PromptTemplateSummary[] = [
  {
    id: 'k-editorial-magazine-cover',
    surface: 'image',
    title: 'K-Editorial Magazine Cover',
    summary: 'English fallback summary',
    category: 'Social Media Post',
    tags: ['fashion', 'portrait', 'typography'],
    model: 'gpt-image-2',
    aspect: '1:1',
    previewImageUrl: '/prompt-template-previews/image/k-editorial-magazine-cover.svg',
    source: { repo: 'nexu-io/open-design', license: 'Apache-2.0' },
  },
  {
    id: 'seedance-video',
    surface: 'video',
    title: 'Seedance Video',
    summary: 'Video template',
    category: 'Cinematic',
    tags: ['cinematic'],
    model: 'seedance-2.0',
    aspect: '16:9',
    source: { repo: 'nexu-io/open-design', license: 'Apache-2.0' },
  },
];

describe('NewProjectPanel prompt template picker items', () => {
  it('localizes image reference templates and searches Korean display copy', () => {
    const items = getPromptTemplatePickerItems({
      locale: 'ko',
      surface: 'image',
      templates,
      query: '에디토리얼',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('k-editorial-magazine-cover');
    expect(items[0]?.title).toBe('K-에디토리얼 매거진 커버');
    expect(items[0]?.category).toBe('소셜 미디어 게시물');
  });

  it('keeps future image templates in the reference picker by surface', () => {
    const items = getPromptTemplatePickerItems({
      locale: 'en',
      surface: 'image',
      templates,
      query: '',
    });

    expect(items.map((item) => item.id)).toEqual(['k-editorial-magazine-cover']);
  });
});

describe('NewProjectPanel image provider visibility', () => {
  it('shows Nano Banana in supported image models', () => {
    const models = supportedModels('image', IMAGE_MODELS);
    expect(models.some((model) => model.provider === 'nanobanana')).toBe(true);
    expect(models.some((model) => model.id === 'gemini-3.1-flash-image-preview')).toBe(true);
  });

  it('shows ElevenLabs speech models in supported audio models', () => {
    const models = supportedModels('audio', AUDIO_MODELS_BY_KIND.speech);
    expect(models.some((model) => model.provider === 'elevenlabs')).toBe(true);
    expect(models.some((model) => model.id === 'elevenlabs-v3')).toBe(true);
  });

  it('shows ElevenLabs sound effects models in supported audio models', () => {
    const models = supportedModels('audio', AUDIO_MODELS_BY_KIND.sfx);
    expect(models.some((model) => model.id === 'elevenlabs-sfx')).toBe(true);
  });
});
