import type {
  MarketplaceTrust,
  TrustTier,
} from '@open-design/contracts';
import { useI18n } from '../i18n';

type TrustBadgeTrust = TrustTier | MarketplaceTrust;
type NormalizedTrustTier = 'official' | 'trusted' | 'restricted';

interface Props {
  trust: TrustBadgeTrust;
  label?: string;
  className?: string;
  variant?: 'default' | 'overlay';
}

const TRUST_META: Record<
  NormalizedTrustTier,
  { label: string; description: string }
> = {
  official: {
    label: 'Official',
    description: 'Open Design official',
  },
  trusted: {
    label: 'Trusted',
    description: 'Community trusted',
  },
  restricted: {
    label: 'Restricted',
    description: 'Restricted source',
  },
};

export function TrustBadge({
  trust,
  label,
  className,
  variant = 'default',
}: Props) {
  const { locale } = useI18n();
  const tier = normalizeTrustTier(trust);
  const meta = TRUST_META[tier];
  const localized = TRUST_META_KO[tier] ?? meta;
  const displayMeta = locale === 'ko' ? localized : meta;
  const text = label ?? displayMeta.label;
  const classes = [
    'plugin-trust-badge',
    `plugin-trust-badge--${tier}`,
    variant === 'overlay' ? 'plugin-trust-badge--overlay' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      data-trust-tier={tier}
      data-trust-source={trust}
      title={displayMeta.description}
      aria-label={`${displayMeta.description}: ${text}`}
    >
      <span className="plugin-trust-badge__dot" aria-hidden />
      <span>{text}</span>
    </span>
  );
}

const TRUST_META_KO: Record<
  NormalizedTrustTier,
  { label: string; description: string }
> = {
  official: {
    label: '공식',
    description: 'Open Design 공식',
  },
  trusted: {
    label: '신뢰됨',
    description: '커뮤니티 신뢰',
  },
  restricted: {
    label: '제한됨',
    description: '제한된 출처',
  },
};

export function normalizeTrustTier(trust: TrustBadgeTrust): NormalizedTrustTier {
  if (trust === 'bundled' || trust === 'official') return 'official';
  if (trust === 'trusted') return 'trusted';
  return 'restricted';
}
