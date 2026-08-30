
export function isHiddenFolderName(name: string): boolean {
  return (
    name.startsWith('.') ||
    name.startsWith('_')
  );
}
