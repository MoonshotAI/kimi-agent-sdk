import * as path from "node:path";
import * as fs from "fs";
import { KimiPaths } from "../../../agent_sdk/paths";
import type { FileChange } from "../../shared/types";

function toRelative(workDir: string, absolutePath: string): string {
  return path.relative(workDir, absolutePath);
}

function toAbsolute(workDir: string, relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(workDir, relativePath);
}

function getBaselinePath(workDir: string, sessionId: string, relativePath: string): string {
  return path.join(KimiPaths.baselineDir(workDir, sessionId), relativePath);
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split("\n").length;
}

function computeLineDiff(oldContent: string, newContent: string): { additions: number; deletions: number } {
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent ? newContent.split("\n") : [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let additions = 0;
  let deletions = 0;

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      additions++;
    }
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) {
      deletions++;
    }
  }

  return { additions, deletions };
}

export const BaselineManager = {
  initSession(workDir: string, sessionId: string): void {
    const baselineDir = KimiPaths.baselineDir(workDir, sessionId);
    if (!fs.existsSync(baselineDir)) {
      fs.mkdirSync(baselineDir, { recursive: true });
    }
  },

  saveBaseline(workDir: string, sessionId: string, relativePath: string, content: string): void {
    const baselinePath = getBaselinePath(workDir, sessionId, relativePath);

    // 只保存首次的 baseline，后续修改不覆盖
    if (fs.existsSync(baselinePath)) {
      return;
    }

    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, content, "utf-8");
  },

  getBaselineContent(workDir: string, sessionId: string, relativePath: string): string | null {
    const baselinePath = getBaselinePath(workDir, sessionId, relativePath);
    try {
      return fs.readFileSync(baselinePath, "utf-8");
    } catch {
      return null;
    }
  },

  async getChanges(workDir: string, sessionId: string, trackedFiles: Set<string>): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    for (const absolutePath of trackedFiles) {
      const relativePath = toRelative(workDir, absolutePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        continue;
      }

      const baselineContent = this.getBaselineContent(workDir, sessionId, relativePath);
      if (baselineContent === null) {
        continue;
      }

      const currentExists = fs.existsSync(absolutePath);
      const isNewFile = baselineContent === "";

      // 文件被删除
      if (!currentExists && !isNewFile) {
        changes.push({
          path: relativePath,
          status: "Deleted",
          additions: 0,
          deletions: countLines(baselineContent),
        });
        continue;
      }

      // 新建的文件被删除 = 无变化，跳过
      if (!currentExists && isNewFile) {
        continue;
      }

      let currentContent: string;
      try {
        currentContent = fs.readFileSync(absolutePath, "utf-8");
      } catch {
        continue;
      }

      // 新建文件
      if (isNewFile) {
        changes.push({
          path: relativePath,
          status: "Added",
          additions: countLines(currentContent),
          deletions: 0,
        });
        continue;
      }

      // 修改文件
      if (currentContent !== baselineContent) {
        const { additions, deletions } = computeLineDiff(baselineContent, currentContent);
        changes.push({
          path: relativePath,
          status: "Modified",
          additions,
          deletions,
        });
      }
    }

    return changes;
  },

  revertFile(workDir: string, sessionId: string, relativePath: string): void {
    const absolutePath = toAbsolute(workDir, relativePath);
    const baselineContent = this.getBaselineContent(workDir, sessionId, relativePath);

    if (baselineContent === null) {
      return;
    }

    // baseline 为空表示新建文件，revert = 删除
    if (baselineContent === "") {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
      return;
    }

    // 恢复原始内容
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, baselineContent, "utf-8");
  },

  revertAll(workDir: string, sessionId: string, trackedFiles: Set<string>): void {
    for (const absolutePath of trackedFiles) {
      const relativePath = toRelative(workDir, absolutePath);
      this.revertFile(workDir, sessionId, relativePath);
    }
  },

  clearBaselines(workDir: string, sessionId: string, trackedFiles: Set<string>): void {
    for (const absolutePath of trackedFiles) {
      const relativePath = toRelative(workDir, absolutePath);
      const baselinePath = getBaselinePath(workDir, sessionId, relativePath);
      if (fs.existsSync(baselinePath)) {
        fs.unlinkSync(baselinePath);
      }
    }
  },

  clearBaseline(workDir: string, sessionId: string, relativePath: string): void {
    const baselinePath = getBaselinePath(workDir, sessionId, relativePath);
    if (fs.existsSync(baselinePath)) {
      fs.unlinkSync(baselinePath);
    }
  },
};
