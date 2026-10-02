/**
 * `detect_changes` compare scope diffs against the MERGE BASE of `base_ref`
 * and HEAD, not against `base_ref`'s tip.
 *
 * With a plain `git diff main`, every commit landed on main after the branch
 * point shows up in the diff as a reverted change, so a PR's change set picked
 * up symbols it never touched. Here the branch edits `a` while main moves on
 * and edits `b`: only `a` may be reported. Unrelated histories have no merge
 * base, so the run falls back to the tip and says so in `compare_base.warning`.
 */
import { it, expect, beforeAll, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { LocalBackend, resolveCompareMergeBase } from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';
import { withTestLbugDB } from '../helpers/test-indexed-db.js';
import { createTempDirPool } from '../helpers/temp-dir-pool.js';
import { commitAll, initGitRepo } from '../helpers/temp-git-repo.js';

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
  cleanupOldKuzuFiles: vi.fn().mockResolvedValue({ found: false, needsReindex: false }),
  findSiblingClones: vi.fn().mockResolvedValue([]),
}));

const tempDirs = createTempDirPool('gnx-merge-base-');

// 0-based lines, as the pipeline stores them: each covers source lines 1-2.
const SEED = [
  `CREATE (fn:Function {id: 'Function:lib/a.py:a', name: 'a', filePath: 'lib/a.py', startLine: 0, endLine: 1, isExported: true})`,
  `CREATE (fn:Function {id: 'Function:lib/b.py:b', name: 'b', filePath: 'lib/b.py', startLine: 0, endLine: 1, isExported: true})`,
];

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dir: string, file: string, body: string): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

/** main: init → (edit b). feat: init → (edit a). HEAD on feat. */
function makeDivergedRepo(): { repoDir: string; branchPoint: string } {
  const repoDir = tempDirs.dir();
  write(repoDir, 'lib/a.py', 'def a():\n    return 1\n');
  write(repoDir, 'lib/b.py', 'def b():\n    return 1\n');
  initGitRepo(repoDir);
  commitAll(repoDir, 'init');
  git(repoDir, 'branch', '-M', 'main');
  const branchPoint = git(repoDir, 'rev-parse', 'HEAD');

  git(repoDir, 'checkout', '-q', '-b', 'feat');
  write(repoDir, 'lib/a.py', 'def a():\n    return 2\n');
  commitAll(repoDir, 'feat: edit a');

  git(repoDir, 'checkout', '-q', 'main');
  write(repoDir, 'lib/b.py', 'def b():\n    return 2\n');
  commitAll(repoDir, 'main: edit b');

  git(repoDir, 'checkout', '-q', '--orphan', 'unrelated');
  commitAll(repoDir, 'unrelated root');

  git(repoDir, 'checkout', '-q', 'feat');
  return { repoDir, branchPoint };
}

type CompareResult = {
  error?: unknown;
  changed_symbols: { name: string }[];
  compare_base?: { base_ref: string; merge_base?: string; warning?: string };
};

let repoDir = '';
let branchPoint = '';

withTestLbugDB(
  'detect-changes-compare-merge-base',
  (handle) => {
    let backend: LocalBackend;
    beforeAll(() => {
      backend = (handle as typeof handle & { _backend: LocalBackend })._backend;
    });

    it('reports only the branch’s own change once main has moved on', async () => {
      const result = (await backend.callTool('detect_changes', {
        scope: 'compare',
        base_ref: 'main',
      })) as CompareResult;
      expect(result.error).toBeUndefined();
      expect(result.changed_symbols.map((s) => s.name)).toEqual(['a']);
      expect(result.compare_base).toEqual({ base_ref: 'main', merge_base: branchPoint });
    });

    it('falls back to the tip with a warning when there is no merge base', async () => {
      const result = (await backend.callTool('detect_changes', {
        scope: 'compare',
        base_ref: 'unrelated',
      })) as CompareResult;
      expect(result.error).toBeUndefined();
      expect(result.compare_base?.merge_base).toBeUndefined();
      expect(result.compare_base?.warning).toMatch(/merge base/);
    });

    it('refuses a ref that git would read as an option', () => {
      expect(resolveCompareMergeBase(execFileSync, repoDir, '--all')).toEqual({
        reason: 'base_ref must not start with "-"',
      });
    });
  },
  {
    seed: SEED,
    poolAdapter: true,
    afterSetup: async (handle) => {
      ({ repoDir, branchPoint } = makeDivergedRepo());
      vi.mocked(listRegisteredRepos).mockResolvedValue([
        {
          name: 'merge-base-repo',
          path: repoDir,
          storagePath: handle.tmpHandle.dbPath,
          indexedAt: new Date().toISOString(),
          lastCommit: 'abc1234',
          stats: { files: 2, nodes: 2, communities: 0, processes: 0 },
        },
      ]);
      const backend = new LocalBackend();
      await backend.init();
      (handle as typeof handle & { _backend?: LocalBackend })._backend = backend;
    },
  },
);
