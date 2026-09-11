import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
let revision = 0;
interface GeneralState {
  host: string;
  visible: boolean;
  canMutate: boolean;
  fail: boolean;
  deferred: boolean;
}
export const general = {
  host: 'a',
  visible: true,
  canMutate: true,
  fail: false,
  deferred: false,
  saves: [] as { host: string; root: string | null }[],
  themes: [] as unknown[],
  completions: 0,
  dirty: false,
  finish: () => {},
  update(patch: Partial<GeneralState>) {
    Object.assign(general, patch);
    revision++;
    listeners.forEach((listener) => listener());
  },
};
Object.assign(window, { generalFixture: general });
const clients = {
  a: { target: { kind: 'remote', id: 'a', apiHostId: 'a' } },
  b: { target: { kind: 'remote', id: 'b', apiHostId: 'b' } },
};
export function useGeneralFixture() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision
  );
}
export const useSettingsMachineClient = () =>
  clients[general.host as 'a' | 'b'];
export const useSettingsMachineState = () => ({ canMutate: general.canMutate });
const setDirty = (_key: string, value: boolean) => {
  general.dirty = value;
};
export const useSettingsDirty = () => ({ setDirty });
export const useTheme = () => ({
  setTheme: (theme: unknown) => general.themes.push(theme),
});
export const useIsMobile = () => false;
export const TagManager = () => null;
export const FolderPickerDialog = { show: async () => null };
