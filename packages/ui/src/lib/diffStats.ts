export type DiffStatsChange = {
  action: 'edit' | 'write' | 'delete' | 'rename';
  unified_diff?: string;
  content?: string;
};

export function parseUnifiedDiffStats(unifiedDiff: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export function getFileChangeStats(change: DiffStatsChange) {
  if (change.action === 'edit' && change.unified_diff) {
    return parseUnifiedDiffStats(change.unified_diff);
  }

  if (change.action === 'write' && change.content) {
    return { additions: change.content.split('\n').length, deletions: 0 };
  }

  return { additions: 0, deletions: 0 };
}
