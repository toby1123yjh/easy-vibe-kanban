/** System-owned identity from 20260919000000_default_project.sql. */
export const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000003';
export const isDefaultProject = (projectId: string | null | undefined) =>
  projectId === DEFAULT_PROJECT_ID;
