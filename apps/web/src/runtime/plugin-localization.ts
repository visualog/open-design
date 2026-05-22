import type { InstalledPluginRecord } from '@open-design/contracts';
import type { Locale } from '../i18n';

interface LocalizedPluginText {
  title?: unknown;
  description?: unknown;
}

interface ManifestWithLocalizedText {
  localized?: Record<string, LocalizedPluginText>;
  od?: {
    localized?: Record<string, LocalizedPluginText>;
  };
}

export function localizedPluginTitle(record: InstalledPluginRecord, locale: Locale): string {
  return localizedPluginField(record, locale, 'title') ?? record.title;
}

export function localizedPluginDescription(record: InstalledPluginRecord, locale: Locale): string {
  return localizedPluginField(record, locale, 'description') ?? record.manifest?.description ?? '';
}

function localizedPluginField(
  record: InstalledPluginRecord,
  locale: Locale,
  field: keyof LocalizedPluginText,
): string | null {
  const manifest = record.manifest as ManifestWithLocalizedText | undefined;
  const exact =
    readLocalizedField(manifest?.od?.localized, locale, field) ??
    readLocalizedField(manifest?.localized, locale, field);
  if (exact) return exact;

  const baseLocale = locale.split('-')[0] ?? locale;
  return (
    readLocalizedField(manifest?.od?.localized, baseLocale, field) ??
    readLocalizedField(manifest?.localized, baseLocale, field)
  );
}

function readLocalizedField(
  localized: Record<string, LocalizedPluginText> | undefined,
  locale: string,
  field: keyof LocalizedPluginText,
): string | null {
  const value = localized?.[locale]?.[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
