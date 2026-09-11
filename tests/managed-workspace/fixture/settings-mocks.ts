import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let revision = 0;
const notify = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
export function useSettingsFixture() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
  );
}
const clients = {
  a: { target: { apiHostId: "host-a" } },
  b: { target: { apiHostId: "host-b" } },
};
interface SettingsState {
  value: string | null;
  disabled: boolean;
  canMutate: boolean;
  machine: keyof typeof clients | null;
}
export const settings = {
  value: null as string | null,
  disabled: false,
  canMutate: true,
  machine: "a" as SettingsState["machine"],
  calls: [] as unknown[],
  changes: [] as (string | null)[],
  resolve: (_value: string | null) => {},
  change(value: string | null) {
    settings.value = value;
    settings.changes.push(value);
    notify();
  },
  update(patch: Partial<SettingsState>) {
    Object.assign(settings, patch);
    notify();
  },
};
Object.assign(window, { settingsFixture: settings });
export const useSettingsMachineClient = () =>
  settings.machine ? clients[settings.machine] : null;
export const useSettingsMachineState = () => ({
  canMutate: settings.canMutate,
});
export const FolderPickerDialog = {
  show: (options: unknown) => {
    settings.calls.push(options);
    return new Promise<string | null>((resolve) => {
      settings.resolve = resolve;
    });
  },
};
