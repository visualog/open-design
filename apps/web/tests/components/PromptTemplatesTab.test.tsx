// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { PromptTemplatesTab } from '../../src/components/PromptTemplatesTab';
import type { PromptTemplateSummary } from '../../src/types';

const TEMPLATES: PromptTemplateSummary[] = [
  {
    id: 'alpha-old',
    surface: 'image',
    title: 'Alpha old',
    summary: 'Older alphabetical first template.',
    category: 'General',
    source: { repo: 'nexu-io/open-design', license: 'Apache-2.0' },
  },
  {
    id: 'beta-old',
    surface: 'image',
    title: 'Beta old',
    summary: 'Older middle template.',
    category: 'General',
    importedAt: '2025-01-01',
    source: { repo: 'YouMind-OpenLab/awesome-gpt-image-2', license: 'CC-BY-4.0' },
  },
  {
    id: 'zulu-new',
    surface: 'image',
    title: 'Zulu new',
    summary: 'Newer template that should sort first by recency.',
    category: 'General',
    importedAt: '2026-05-22',
    source: { repo: 'YouMind-OpenLab/awesome-gpt-image-2', license: 'CC-BY-4.0' },
  },
];

afterEach(() => cleanup());

describe('PromptTemplatesTab', () => {
  it('can sort newest imported templates first and marks them as new', () => {
    render(
      <I18nProvider initial="en">
        <PromptTemplatesTab surface="image" templates={TEMPLATES} onPreview={vi.fn()} />
      </I18nProvider>,
    );

    expect(cardTitles()).toEqual(['Alpha old', 'Beta old', 'Zulu new']);

    fireEvent.change(screen.getByLabelText('Sort templates'), {
      target: { value: 'newest' },
    });

    expect(cardTitles()).toEqual(['Zulu new', 'Beta old', 'Alpha old']);
    const newestCard = screen.getAllByTitle('Open prompt and preview')[0];
    if (!newestCard) throw new Error('Missing newest card');
    expect(within(newestCard).getByText('New')).toBeTruthy();
  });
});

function cardTitles(): string[] {
  return screen
    .getAllByTitle('Open prompt and preview')
    .map((card) => within(card).getByText(/old|new/).textContent ?? '');
}
