import type { ShapeDefinition } from "shared/remote-types";
import { useShape as useRealShape } from "../../../../packages/web-core/src/shared/integrations/electric/hooks";
import { useFixtureProjects } from "./projectSettingsMock";

const empty: never[] = [];
const unusedMutation = () => {
  throw new Error("Unexpected fixture mutation");
};
// The mode is fixed before mounting; other page fixtures retain their real hooks.
export const useShape =
  new URLSearchParams(window.location.search).get("mode") === "actions"
    ? function useFixtureShape<T>(shape: ShapeDefinition<T>) {
        const projects = useFixtureProjects();
        return {
          data: shape.table === "projects" ? projects : empty,
          isLoading: false,
          error: null,
          retry: () => undefined,
          update: unusedMutation,
          insert: unusedMutation,
          remove: unusedMutation,
          updateMany: unusedMutation,
        };
      }
    : useRealShape;
