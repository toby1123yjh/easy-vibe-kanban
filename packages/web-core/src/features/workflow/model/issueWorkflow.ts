export function buildWorkflowRunInput({
  title,
  description,
}: {
  title: string;
  description?: string | null;
}): string {
  if (description && description.trim().length > 0) {
    return `${title}\n\n${description}`;
  }
  return title;
}
