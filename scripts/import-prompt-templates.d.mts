export interface PromptTemplateImportSource {
  surface: 'image' | 'video';
  repo: string;
  license: 'CC-BY-4.0';
  licenseUrl: string;
  readmeUrl: string;
  defaultModel: string;
  defaultAspect: string;
  sampleAllPrompts: number;
}

export const SOURCES: PromptTemplateImportSource[];

export function validateSourceLicense(
  source: PromptTemplateImportSource,
  licenseText: string,
): void;

export function validateImportedEntry(
  entry: unknown,
  source: PromptTemplateImportSource,
): string | null;
