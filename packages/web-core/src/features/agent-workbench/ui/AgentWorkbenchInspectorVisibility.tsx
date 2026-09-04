import { createContext, useContext, type ReactNode } from 'react';

const AgentWorkbenchInspectorVisibilityContext = createContext(true);

export function AgentWorkbenchInspectorVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <AgentWorkbenchInspectorVisibilityContext.Provider value={visible}>
      {children}
    </AgentWorkbenchInspectorVisibilityContext.Provider>
  );
}

export function useAgentWorkbenchInspectorVisibility() {
  return useContext(AgentWorkbenchInspectorVisibilityContext);
}
