import { expect, test } from '@playwright/test';
import {
  isCanonicalSettingsSearch,
  parseSettingsSearch,
  resolveSettingsRoute,
} from './settingsRoute';

test.describe('Settings route model', () => {
  test('defaults to the canonical General application route', () => {
    const search = parseSettingsSearch({});
    const route = resolveSettingsRoute(search);

    expect(route).toEqual({ tab: 'general', section: 'application' });
    expect(isCanonicalSettingsSearch(search, route)).toBe(false);
  });

  test('uses the section owner when no valid tab is supplied', () => {
    expect(resolveSettingsRoute({ section: 'repositories' })).toEqual({
      tab: 'host',
      section: 'repositories',
    });
    expect(resolveSettingsRoute({ tab: 'unknown', section: 'relay' })).toEqual({
      tab: 'cloud',
      section: 'relay',
    });
  });

  test('keeps an explicit valid tab and canonicalizes mismatched sections', () => {
    expect(
      resolveSettingsRoute({ tab: 'host', section: 'organizations' })
    ).toEqual({ tab: 'host', section: 'repositories' });
    expect(resolveSettingsRoute({ tab: 'cloud', section: 'unknown' })).toEqual({
      tab: 'cloud',
      section: 'relay',
    });
  });

  test('canonicalizes legacy section aliases', () => {
    expect(resolveSettingsRoute({ section: 'appearance' })).toEqual({
      tab: 'general',
      section: 'application',
    });
    expect(resolveSettingsRoute({ section: 'remote-projects' })).toEqual({
      tab: 'cloud',
      section: 'projects',
    });
  });

  test('drops non-string and empty search values', () => {
    expect(
      parseSettingsSearch({ tab: ['cloud'], section: '', extra: 'ignored' })
    ).toEqual({ tab: undefined, section: undefined });
  });
});
