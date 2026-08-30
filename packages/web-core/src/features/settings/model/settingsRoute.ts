export const SETTINGS_TABS = ['general', 'host', 'cloud'] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type SettingsSection =
  | 'application'
  | 'repositories'
  | 'relay'
  | 'organizations'
  | 'projects';

export interface SettingsSearchParams {
  tab?: string;
  section?: string;
}

export interface ResolvedSettingsRoute {
  tab: SettingsTab;
  section: SettingsSection;
}

export const SETTINGS_SECTIONS: Readonly<
  Record<SettingsTab, readonly SettingsSection[]>
> = {
  general: ['application'],
  host: ['repositories'],
  cloud: ['relay', 'organizations', 'projects'],
};

const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  general: 'application',
  appearance: 'application',
  repos: 'repositories',
  'remote-projects': 'projects',
};

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseSettingsSearch(
  search: Record<string, unknown>
): SettingsSearchParams {
  return {
    tab: stringParam(search.tab),
    section: stringParam(search.section),
  };
}

function normalizeSection(section: string | undefined) {
  if (!section) return undefined;
  return SECTION_ALIASES[section] ?? section;
}

function owningTab(section: string | undefined): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) =>
    SETTINGS_SECTIONS[tab].includes(section as SettingsSection)
  );
}

export function resolveSettingsRoute(
  search: SettingsSearchParams
): ResolvedSettingsRoute {
  const normalizedSection = normalizeSection(search.section);
  const sectionTab = owningTab(normalizedSection);
  const requestedTab = SETTINGS_TABS.includes(search.tab as SettingsTab)
    ? (search.tab as SettingsTab)
    : undefined;
  const tab = requestedTab ?? sectionTab ?? 'general';
  const section =
    sectionTab === tab
      ? (normalizedSection as SettingsSection)
      : SETTINGS_SECTIONS[tab][0];

  return { tab, section };
}

export function isCanonicalSettingsSearch(
  search: SettingsSearchParams,
  route: ResolvedSettingsRoute
): boolean {
  return search.tab === route.tab && search.section === route.section;
}
