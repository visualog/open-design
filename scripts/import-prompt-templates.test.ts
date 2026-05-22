import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SOURCES,
  validateImportedEntry,
  validateSourceLicense,
} from './import-prompt-templates.mjs';

test('prompt template imports are limited to approved attributed sources', () => {
  assert.equal(SOURCES.length, 2);
  assert.deepEqual(
    SOURCES.map((source) => ({
      repo: source.repo,
      license: source.license,
      licenseUrl: source.licenseUrl,
    })),
    [
      {
        repo: 'YouMind-OpenLab/awesome-gpt-image-2',
        license: 'CC-BY-4.0',
        licenseUrl: 'https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/LICENSE',
      },
      {
        repo: 'YouMind-OpenLab/awesome-seedance-2-prompts',
        license: 'CC-BY-4.0',
        licenseUrl: 'https://raw.githubusercontent.com/YouMind-OpenLab/awesome-seedance-2-prompts/main/LICENSE',
      },
    ],
  );

  for (const source of SOURCES) {
    assert.doesNotThrow(() =>
      validateSourceLicense(
        source,
        'Creative Commons Attribution 4.0 International License (CC BY 4.0)',
      ),
    );
  }
});

test('prompt template import validation rejects unsafe or incomplete entries', () => {
  const source = SOURCES[0];
  assert.ok(source);

  const validEntry = {
    id: 'sample-image-template',
    surface: 'image',
    title: 'Sample Image Template',
    summary: 'A sample community prompt template.',
    category: 'Illustration',
    tags: ['illustration'],
    model: 'gpt-image-2',
    aspect: '1:1',
    prompt:
      'Create a polished editorial illustration for a product launch with careful composition, usable negative space, and detailed lighting direction.',
    previewImageUrl: 'https://example.com/preview.jpg',
    source: {
      repo: source.repo,
      license: source.license,
      author: 'YouMind OpenLab',
      url: 'https://example.com/source',
    },
  };

  assert.equal(validateImportedEntry(validEntry, source), null);
  assert.match(
    validateImportedEntry({ ...validEntry, source: { ...validEntry.source, license: 'NOASSERTION' } }, source) ?? '',
    /license/i,
  );
  assert.match(
    validateImportedEntry({ ...validEntry, previewImageUrl: 'javascript:alert(1)' }, source) ?? '',
    /previewImageUrl/i,
  );
  assert.match(
    validateImportedEntry({ ...validEntry, prompt: 'too short' }, source) ?? '',
    /prompt/i,
  );
});
