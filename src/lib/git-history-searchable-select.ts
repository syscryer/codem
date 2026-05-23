export type GitHistorySearchableOption = {
  value: string;
  label: string;
};

export function filterGitHistorySearchableOptions(
  options: ReadonlyArray<GitHistorySearchableOption>,
  keyword: string,
) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return [...options];
  }
  return options.filter((option) => {
    const haystack = `${option.label}\n${option.value}`.toLowerCase();
    return haystack.includes(normalizedKeyword);
  });
}
