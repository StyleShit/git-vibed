import { describe, expect, it } from "vitest";
import { parseGitLog, parseUnifiedDiff } from "./parser";

// Build the raw string git log --format produces for a single commit.
function rec(parts: {
  hash: string;
  parents?: string;
  author?: string;
  email?: string;
  timestamp?: number;
  decorations?: string;
  subject?: string;
  body?: string;
}): string {
  const fields = [
    parts.hash,
    parts.parents ?? "",
    parts.author ?? "Alice",
    parts.email ?? "alice@example.com",
    String(parts.timestamp ?? 1000),
    parts.decorations ?? "",
    parts.subject ?? "subject",
    parts.body ?? "",
  ];
  return fields.join("\x01") + "\x02";
}

describe("parseGitLog", () => {
  it("returns an empty array for empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });

  it("parses a single commit with no parents and no refs", () => {
    const [c] = parseGitLog(
      rec({ hash: "abc1234", subject: "initial", body: "" }),
    );
    expect(c.hash).toBe("abc1234");
    expect(c.parents).toEqual([]);
    expect(c.author).toBe("Alice");
    expect(c.email).toBe("alice@example.com");
    expect(c.timestamp).toBe(1000);
    expect(c.subject).toBe("initial");
    expect(c.body).toBeUndefined();
    expect(c.refs).toEqual([]);
  });

  it("splits parents on whitespace (merge commit has 2+)", () => {
    const [c] = parseGitLog(rec({ hash: "m", parents: "p1 p2 p3" }));
    expect(c.parents).toEqual(["p1", "p2", "p3"]);
  });

  it("normalizes ref decorations: HEAD ->, tag:, and full refs/* paths", () => {
    const [c] = parseGitLog(
      rec({
        hash: "h",
        decorations:
          "HEAD -> refs/heads/main, tag: v1.0, refs/remotes/origin/feature",
      }),
    );
    expect(c.refs).toEqual(["main", "tag:v1.0", "origin/feature"]);
  });

  it("handles a subject with trailing whitespace and an empty body", () => {
    const [c] = parseGitLog(
      rec({ hash: "h", subject: "  spaced  ", body: "   " }),
    );
    expect(c.subject).toBe("spaced");
    expect(c.body).toBeUndefined();
  });

  it("parses multiple commits separated by the record separator", () => {
    const raw = rec({ hash: "a" }) + rec({ hash: "b" });
    const commits = parseGitLog(raw);
    expect(commits.map((c) => c.hash)).toEqual(["a", "b"]);
  });
});

describe("parseUnifiedDiff", () => {
  it("returns an empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("parses a single-file, single-hunk diff with add/del/context lines", () => {
    const raw = [
      "diff --git a/foo.ts b/foo.ts",
      "index 1111..2222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+new",
      " tail",
    ].join("\n");
    const [file] = parseUnifiedDiff(raw);
    expect(file.path).toBe("foo.ts");
    expect(file.oldPath).toBeUndefined();
    expect(file.binary).toBe(false);
    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    const types = hunk.lines.map((l) => l.type);
    expect(types).toEqual(["context", "del", "add", "context"]);
    expect(hunk.lines[1].content).toBe("old");
    expect(hunk.lines[1].oldLineNo).toBe(2);
    expect(hunk.lines[2].newLineNo).toBe(2);
  });

  it("records a rename by surfacing oldPath != newPath", () => {
    const raw = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
    ].join("\n");
    const [file] = parseUnifiedDiff(raw);
    expect(file.path).toBe("new.ts");
    expect(file.oldPath).toBe("old.ts");
    expect(file.hunks).toEqual([]);
  });

  it("flags a binary-only diff", () => {
    const raw = [
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n");
    const [file] = parseUnifiedDiff(raw);
    expect(file.binary).toBe(true);
    expect(file.hunks).toEqual([]);
  });

  it("splits multiple diff sections correctly", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1 @@",
      "-1",
      "+2",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});
