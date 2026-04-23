import { describe, expect, it } from "vitest";
import type { FileChange } from "@shared/types";
import { buildTree } from "./file-tree";

function file(path: string): FileChange {
  return { path, status: "modified", staged: false };
}

describe("buildTree", () => {
  it("returns an empty-rooted tree for no files", () => {
    const root = buildTree([]);
    expect(root.name).toBe("");
    expect(root.children.size).toBe(0);
  });

  it("produces a leaf child for a single top-level file", () => {
    const root = buildTree([file("README.md")]);
    expect(root.children.size).toBe(1);
    const leaf = root.children.get("README.md");
    expect(leaf?.name).toBe("README.md");
    expect(leaf?.file?.path).toBe("README.md");
    expect(leaf?.children.size).toBe(0);
  });

  it("nests files under their folder chain", () => {
    const root = buildTree([file("src/components/Button.tsx")]);
    // Single-child chains get collapsed, so the direct child of root is
    // "src/components" and its child is the file leaf.
    const collapsed = root.children.get("src");
    expect(collapsed?.name).toBe("src/components");
    expect(collapsed?.children.size).toBe(1);
    expect(collapsed?.children.get("Button.tsx")?.file?.path).toBe(
      "src/components/Button.tsx",
    );
  });

  it("keeps sibling branches separate under the collapsed parent", () => {
    const root = buildTree([
      file("src/components/Button.tsx"),
      file("src/components/Card.tsx"),
    ]);
    const node = root.children.get("src");
    expect(node?.name).toBe("src/components");
    expect(node?.children.size).toBe(2);
    expect(node?.children.get("Button.tsx")?.file).toBeDefined();
    expect(node?.children.get("Card.tsx")?.file).toBeDefined();
  });

  it("does not collapse a folder that also contains a same-named file", () => {
    // If `src` has both a `lib` subfolder and a `lib` leaf file, the chain
    // collapse should stop: mixing a file with children would lose data.
    const root = buildTree([
      file("src/lib/a.ts"),
      file("src/lib/b.ts"),
    ]);
    const node = root.children.get("src");
    expect(node?.name).toBe("src/lib");
    expect(node?.children.size).toBe(2);
  });

  it("branches at the first divergence point", () => {
    const root = buildTree([
      file("src/a/x.ts"),
      file("src/b/y.ts"),
    ]);
    // src has two children (a, b) so "src" itself does not collapse further.
    const src = root.children.get("src");
    expect(src?.name).toBe("src");
    expect(src?.children.size).toBe(2);
    expect(src?.children.get("a")?.children.get("x.ts")?.file).toBeDefined();
    expect(src?.children.get("b")?.children.get("y.ts")?.file).toBeDefined();
  });
});
