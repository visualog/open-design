import { describe, expect, it } from 'vitest';

import {
  getPromptTemplatePromptText,
  getPromptTemplatePromptViewOptions,
} from '../../src/components/PromptTemplatePreviewModal';
import type { PromptTemplateDetail } from '../../src/types';

const detail: PromptTemplateDetail = {
  id: 'dopamine-3d-cyclist-wheelie-character',
  surface: 'image',
  title: 'Dopamine 3D Cyclist Wheelie Character',
  summary: 'English summary',
  category: 'Illustration',
  tags: ['3d-render'],
  model: 'gpt-image-2',
  aspect: '1:1',
  prompt: 'Create an English prompt body.',
  localizedPrompts: {
    ko: '한글 프롬프트 본문을 생성합니다.',
  },
  source: { repo: 'nexu-io/open-design', license: 'Apache-2.0' },
};

describe('PromptTemplatePreviewModal prompt language helpers', () => {
  it('offers Korean prompt viewing when a Korean localized prompt is available', () => {
    expect(getPromptTemplatePromptViewOptions(detail)).toEqual(['en', 'ko']);
    expect(getPromptTemplatePromptText(detail, 'ko')).toBe('한글 프롬프트 본문을 생성합니다.');
  });

  it('falls back to English when the requested localized prompt is missing', () => {
    expect(getPromptTemplatePromptText({ ...detail, localizedPrompts: {} }, 'ko')).toBe(
      'Create an English prompt body.',
    );
  });
});
