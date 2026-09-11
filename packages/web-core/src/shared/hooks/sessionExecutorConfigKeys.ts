export const sessionExecutorConfigKey = (
  hostId: string | null | undefined,
  sessionId: string | undefined
) => ['session-executor-config', hostId, sessionId] as const;
