import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import type { RenderedFile } from "@t-stack/templating/in-memory";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  files: RenderedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

interface DirNode {
  type: "dir";
  name: string;
  path: string;
  children: Node[];
}
interface FileNode {
  type: "file";
  name: string;
  path: string;
}
type Node = DirNode | FileNode;

function buildTree(files: RenderedFile[]): DirNode {
  const root: DirNode = { type: "dir", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      const isFile = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      if (isFile) {
        cursor.children.push({ type: "file", name: part, path: childPath });
      } else {
        let dir = cursor.children.find(
          (c): c is DirNode => c.type === "dir" && c.name === part
        );
        if (!dir) {
          dir = { type: "dir", name: part, path: childPath, children: [] };
          cursor.children.push(dir);
        }
        cursor = dir;
      }
    }
  }
  sortTree(root);
  return root;
}

function sortTree(dir: DirNode) {
  dir.children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const c of dir.children) {
    if (c.type === "dir") {
      sortTree(c);
    }
  }
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="font-mono text-xs">
      <TreeChildren
        depth={0}
        nodes={tree.children}
        onSelect={onSelect}
        selectedPath={selectedPath}
      />
    </div>
  );
}

interface TreeChildrenProps {
  nodes: Node[];
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeChildren({
  nodes,
  depth,
  selectedPath,
  onSelect,
}: TreeChildrenProps) {
  return (
    <ul>
      {nodes.map((child) =>
        child.type === "dir" ? (
          <Dir
            depth={depth}
            key={child.path}
            node={child}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ) : (
          <FileItem
            depth={depth}
            key={child.path}
            node={child}
            onSelect={onSelect}
            selected={selectedPath === child.path}
          />
        )
      )}
    </ul>
  );
}

function Dir({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <button
        className="flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-[var(--color-accent)]"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        type="button"
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0" />
        )}
        <Folder
          aria-hidden
          className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]"
        />
        <span className="truncate">{node.name}</span>
      </button>
      {open ? (
        <TreeChildren
          depth={depth + 1}
          nodes={node.children}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ) : null}
    </li>
  );
}

function FileItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <li>
      <button
        className={cn(
          "flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-[var(--color-accent)]",
          selected && "bg-[var(--color-accent)] text-[var(--color-primary)]"
        )}
        onClick={() => onSelect(node.path)}
        style={{
          paddingLeft: `${0.5 + depth * 0.75 + 0.875}rem`,
        }}
        type="button"
      >
        <File
          aria-hidden
          className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]"
        />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
