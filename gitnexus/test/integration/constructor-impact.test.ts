/**
 * Integration Tests: upstream impact on a member-method constructor.
 *
 * In JS/TS and Python the constructor is a Method (`constructor`, `__init__`)
 * under its Class, and `new Foo()` / `Foo()` is recorded as CALLS -> Class, so
 * the constructor itself has no incoming CALLS. Upstream impact on it used to
 * resolve zero callers. It must now report the class's callers as depth-1
 * dependents and keep walking from them. A non-constructor method on the same
 * class must not pick up the class's callers.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';
import { withTestLbugDB } from '../helpers/test-indexed-db.js';

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
  cleanupOldKuzuFiles: vi.fn().mockResolvedValue({ found: false, needsReindex: false }),
  findSiblingClones: vi.fn().mockResolvedValue([]),
}));

function memberCtorNodes(lang: string, cls: string, ctorName: string, path: string): string[] {
  // The engine needs a label on each endpoint to bind a CREATE rel.
  const label = (id: string) =>
    id.includes(':class:') ? 'Class' : id.includes(':fn:') ? 'Function' : 'Method';
  const rel = (from: string, to: string, type: string) =>
    `MATCH (a:${label(from)} {id:'${from}'}), (b:${label(to)} {id:'${to}'}) CREATE (a)-[:CodeRelation {type:'${type}', confidence:0.9, reason:'', step:0}]->(b)`;
  return [
    `CREATE (c:Class {id:'${lang}:class:${cls}', name:'${cls}', filePath:'${path}', startLine:1, endLine:50, isExported:true, content:'', description:''})`,
    `CREATE (m:Method {id:'${lang}:ctor:${cls}', name:'${ctorName}', filePath:'${path}', startLine:2, endLine:5, isExported:false, content:'', description:''})`,
    `CREATE (m:Method {id:'${lang}:other:${cls}', name:'render', filePath:'${path}', startLine:6, endLine:9, isExported:false, content:'', description:''})`,
    `CREATE (f:Function {id:'${lang}:fn:build', name:'build', filePath:'src/${lang}/factory', startLine:1, endLine:5, isExported:true, content:'', description:''})`,
    `CREATE (f:Function {id:'${lang}:fn:main', name:'main', filePath:'src/${lang}/main', startLine:1, endLine:5, isExported:true, content:'', description:''})`,
    `CREATE (f:Function {id:'${lang}:fn:spec', name:'spec', filePath:'test/${lang}/widget.test', startLine:1, endLine:5, isExported:false, content:'', description:''})`,
    rel(`${lang}:class:${cls}`, `${lang}:ctor:${cls}`, 'HAS_METHOD'),
    rel(`${lang}:class:${cls}`, `${lang}:other:${cls}`, 'HAS_METHOD'),
    rel(`${lang}:fn:build`, `${lang}:class:${cls}`, 'CALLS'),
    rel(`${lang}:fn:spec`, `${lang}:class:${cls}`, 'CALLS'),
    rel(`${lang}:fn:main`, `${lang}:fn:build`, 'CALLS'),
  ];
}

const SEED = [
  ...memberCtorNodes('ts', 'Widget', 'constructor', 'src/ts/widget.ts'),
  ...memberCtorNodes('py', 'Gadget', '__init__', 'src/py/gadget.py'),
];

const namesByDepth = (result: any): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(result.byDepth as Record<string, any[]>).map(([d, items]) => [
      d,
      items.map((i) => i.name),
    ]),
  );

withTestLbugDB(
  'constructor-impact',
  (handle) => {
    let backend: LocalBackend;
    beforeAll(() => {
      backend = (handle as any)._backend;
    });

    for (const lang of ['ts', 'py']) {
      describe(`${lang}: member-method constructor`, () => {
        it('reports the class callers at depth 1 and walks on from them', async () => {
          const result = await backend.callTool('impact', {
            target_uid: `${lang}:ctor:${lang === 'ts' ? 'Widget' : 'Gadget'}`,
            direction: 'upstream',
          });
          expect(result).not.toHaveProperty('error');
          expect(result.partial).toBeUndefined();
          expect(namesByDepth(result)).toEqual({ '1': ['build'], '2': ['main'] });
          expect(result.risk).not.toBe('UNKNOWN');
        });

        it('keeps test-file callers out unless includeTests is set', async () => {
          const result = await backend.callTool('impact', {
            target_uid: `${lang}:ctor:${lang === 'ts' ? 'Widget' : 'Gadget'}`,
            direction: 'upstream',
            includeTests: true,
          });
          expect(namesByDepth(result)['1']).toEqual(['build', 'spec']);
        });

        it('does not give an ordinary method the class callers', async () => {
          const result = await backend.callTool('impact', {
            target_uid: `${lang}:other:${lang === 'ts' ? 'Widget' : 'Gadget'}`,
            direction: 'upstream',
          });
          expect(result).not.toHaveProperty('error');
          expect(result.impactedCount).toBe(0);
        });
      });
    }
  },
  {
    seed: SEED,
    poolAdapter: true,
    afterSetup: async (handle) => {
      vi.mocked(listRegisteredRepos).mockResolvedValue([
        {
          name: 'test-repo',
          path: '/test/repo',
          storagePath: handle.tmpHandle.dbPath,
          indexedAt: new Date().toISOString(),
          lastCommit: 'abc123',
          stats: { files: 6, nodes: 12, communities: 0, processes: 0 },
        },
      ]);
      const backend = new LocalBackend();
      await backend.init();
      (handle as any)._backend = backend;
    },
  },
);
