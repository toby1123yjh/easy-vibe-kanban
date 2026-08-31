import {
  getSettingsNavigationTarget,
  SETTINGS_NAVIGATION_SECTIONS,
  SETTINGS_NAVIGATION_TABS,
  type SettingsNavigationSection,
  type SettingsNavigationTab,
  type SettingsNavigationTarget,
} from '@/shared/lib/routes/appNavigation';

export const SETTINGS_TABS = SETTINGS_NAVIGATION_TABS;

export type SettingsTab = SettingsNavigationTab;

export type SettingsSection = SettingsNavigationSection;

export interface SettingsSearchParams {
  tab?: string;
  section?: string;
  host?: string;
}

export type ResolvedSettingsRoute = SettingsNavigationTarget;

export const SETTINGS_SECTIONS = SETTINGS_NAVIGATION_SECTIONS;

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
    host: stringParam(search.host),
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

  return { tab, section, ...(search.host ? { host: search.host } : {}) };
}

export function isCanonicalSettingsSearch(
  search: SettingsSearchParams,
  route: ResolvedSettingsRoute
): boolean {
  return (
    search.tab === route.tab &&
    search.section === route.section &&
    search.host === route.host
  );
}

export function settingsRouteForSection(
  section: SettingsSection,
  host?: string | null
): ResolvedSettingsRoute {
  return getSettingsNavigationTarget(section, host);
}
