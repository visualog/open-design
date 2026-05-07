import { describe, expect, it } from 'vitest';

import { getPromptTemplatePickerItems } from '../../src/components/NewProjectPanel';
import type { PromptTemplateSummary } from '../../src/types';

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
