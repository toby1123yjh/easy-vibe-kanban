export {
  SettingsHostProvider,
  useSettingsHost,
  WorkspaceTargetDialog,
  projectWorkspaceDefaultQueryKey,
  saveProjectWorkspaceDefault,
} from '../../page-surfaces/create-project-fixture/mocks';
export const useHostId = () => undefined;
export const getCurrentHostId = () => null;
export const useSettingsMachineClient = () => null;
export function useShape() {
  return {
    error: null,
    insert(input: object) {
      const data = document.documentElement.dataset;
      const inserts = JSON.parse(data.inserts ?? '[]');
      inserts.push(input);
      data.inserts = JSON.stringify(inserts);
      const project = { id: 'created-project', ...input };
      const shouldFail =
        new URLSearchParams(location.search).has('failCreate') &&
        inserts.length === 1;
      return {
        data: project,
        persisted: shouldFail
          ? Promise.reject(new Error('Project persistence failed'))
          : Promise.resolve(project),
      };
    },
  };
}
