/** Build a nested tree from flat file path keys (e.g. "src/app.py"). */
export function buildFileTree(filePaths) {
  const root = { type: "folder", name: "", children: {} };

  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const key = isFile ? `file:${part}` : `dir:${part}`;

      if (!node.children[key]) {
        node.children[key] = {
          type: isFile ? "file" : "folder",
          name: part,
          fullPath: isFile ? filePath : parts.slice(0, i + 1).join("/"),
          children: isFile ? null : {},
        };
      }
      if (!isFile) node = node.children[key];
    }
  }

  return root;
}

/** Sorted child entries: folders first, then files, alphabetical. */
export function getSortedChildren(folderNode) {
  if (!folderNode?.children) return [];
  return Object.values(folderNode.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Collect all folder paths for default expand state. */
export function getAllFolderPaths(filePaths) {
  const folders = new Set();
  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      folders.add(parts.slice(0, i + 1).join("/"));
    }
  }
  return folders;
}

/** Basename for tab labels. */
export function getBaseName(filePath) {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}
