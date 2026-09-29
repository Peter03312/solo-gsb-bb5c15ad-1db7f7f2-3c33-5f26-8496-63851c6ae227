import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCycle, findPath } from '../src/graph';
import { parseSnapshot } from '../src/importing';
import { buildShareSnapshot, type ShareSnapshot } from '../src/sharing';
import type { Edge, Evidence } from '../src/types';

const NOW = '2026-09-29T00:00:00.000Z';

interface CardSpec {
  title?: string;
  description?: string;
  source?: string;
  occurredAt?: string | null;
}

function makeEvidence(ids: string[], spec: Record<string, CardSpec> = {}): Evidence[] {
  return ids.map((id, i) => ({
    id,
    title: spec[id]?.title ?? `卡片${id}`,
    description: spec[id]?.description ?? '',
    source: spec[id]?.source ?? '',
    occurredAt: spec[id]?.occurredAt ?? null,
    createdAt: `2026-09-${String(Math.min(i + 1, 28)).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: NOW,
  }));
}

function makeEdges(pairs: Array<[string, string]>): Edge[] {
  return pairs.map(([fromId, toId], i) => ({ id: i + 1, fromId, toId, createdAt: NOW }));
}

function edgesOf(s: ShareSnapshot): Array<{ fromId: string; toId: string }> {
  return s.edges.map((e) => ({ fromId: e.from, toId: e.to }));
}

/** 对所有所选卡片两两核对：导出图可达 ⇔ 完整图可达 */
function assertReachEquivalence(
  fullEdges: Edge[],
  snapshot: ShareSnapshot,
  selected: string[],
): void {
  const exported = edgesOf(snapshot);
  for (const a of selected) {
    for (const b of selected) {
      if (a === b) continue;
      const full = findPath(fullEdges, a, b) !== null;
      const shared = findPath(exported, a, b) !== null;
      assert.equal(shared, full, `所选卡片 ${a}→${b} 的可达关系必须与完整图一致`);
    }
  }
}

/** 极小性：移除任一导出边后，该边两端在导出图中不再可达 */
function assertEveryEdgeEssential(snapshot: ShareSnapshot): void {
  const exported = edgesOf(snapshot);
  for (let i = 0; i < exported.length; i++) {
    const rest = exported.filter((_, j) => j !== i);
    const e = exported[i];
    assert.equal(
      findPath(rest, e.fromId, e.toId),
      null,
      `导出边 ${e.fromId}→${e.toId} 必须不可省略：删除后至少一对所选卡片失去可达关系`,
    );
  }
}

test('分享：隐藏路径上的中间卡片——只截原图连线会丢关系，导出边须跨隐藏卡片补出', () => {
  // a → x(未选) → b：原图没有 a→b 直连，但 a 在完整图中可达 b
  const evidence = makeEvidence(['a', 'x', 'b']);
  const full = makeEdges([['a', 'x'], ['x', 'b']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.edges, [{ from: 'a', to: 'b' }]);
  assertReachEquivalence(full, r.snapshot, ['a', 'b']);
  // 未选卡片 x 的记录与 id 不得出现在响应中
  const text = JSON.stringify(r.snapshot);
  assert.ok(!text.includes('"x"'));
  assert.deepEqual(r.snapshot.evidence.map((e) => e.id), ['a', 'b']);
});

test('分享：菱形支路全部经过隐藏卡片，仍补出单条可达边', () => {
  // a → x → b、a → y → b，x、y 均未选
  const evidence = makeEvidence(['a', 'x', 'y', 'b']);
  const full = makeEdges([['a', 'x'], ['x', 'b'], ['a', 'y'], ['y', 'b']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.edges, [{ from: 'a', to: 'b' }]);
  assertReachEquivalence(full, r.snapshot, ['a', 'b']);
});

test('分享：全选三角结构得到传递约简，每条导出边都不可省略', () => {
  const evidence = makeEvidence(['a', 'b', 'c']);
  const full = makeEdges([['a', 'b'], ['b', 'c'], ['a', 'c']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b', 'c'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.edges, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  assertReachEquivalence(full, r.snapshot, ['a', 'b', 'c']);
  assertEveryEdgeEssential(r.snapshot);
});

test('分享：存在所选中间卡片时不跨点连边（中间卡片承担接续）', () => {
  // a→b→c 全选：导出 a→b、b→c，而不是 a→c
  const evidence = makeEvidence(['a', 'b', 'c']);
  const full = makeEdges([['a', 'b'], ['b', 'c']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b', 'c'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.edges, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  assertEveryEdgeEssential(r.snapshot);
});

test('分享：混合隐藏与所选中间点的复杂结构，两两可达与完整图一致', () => {
  // 完整图：a→x(隐)→b→y(隐)→c；另有 a→z(隐)→c；所选 {a,b,c}
  const ids = ['a', 'x', 'b', 'y', 'z', 'c'];
  const evidence = makeEvidence(ids);
  const full = makeEdges([['a', 'x'], ['x', 'b'], ['b', 'y'], ['y', 'c'], ['a', 'z'], ['z', 'c']]);
  const r = buildShareSnapshot(evidence, full, ['c', 'a', 'b'], NOW); // 故意乱序 + 覆盖去重场景
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  // a→b（经 x）、b→c（经 y）必须有；a→c 因存在所选中间 b 而省略
  assert.deepEqual(r.snapshot.edges, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  assertReachEquivalence(full, r.snapshot, ['a', 'b', 'c']);
  assertEveryEdgeEssential(r.snapshot);
});

test('分享：孤立卡片保留（即使与任何卡片都没有可达关系）', () => {
  const evidence = makeEvidence(['a', 'iso', 'b']);
  const full = makeEdges([['a', 'b']]);
  const r = buildShareSnapshot(evidence, full, ['iso'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.evidence.map((e) => e.id), ['iso']);
  assert.deepEqual(r.snapshot.edges, []);
});

test('分享：只选一张卡片时无导出边，仍可通过导入校验', () => {
  const evidence = makeEvidence(['a', 'b']);
  const full = makeEdges([['a', 'b']]);
  const r = buildShareSnapshot(evidence, full, ['b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.evidence.map((e) => e.id), ['b']);
  assert.deepEqual(r.snapshot.edges, []);
});

test('分享：所选卡片字段保持原值（标题/来源/时间/描述/时间戳原样）', () => {
  const evidence = makeEvidence(['a', 'x'], {
    a: { title: '原始标题', description: '原始描述', source: '原始来源', occurredAt: '2026-03-12T02:15' },
  });
  const full = makeEdges([['a', 'x']]);
  const r = buildShareSnapshot(evidence, full, ['a'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.evidence[0], evidence[0]);
});

test('分享：快照沿用 app/version/evidence/edges 与 from/to 格式且无环、可导入', () => {
  const evidence = makeEvidence(['a', 'x', 'b']);
  const full = makeEdges([['a', 'x'], ['x', 'b']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.snapshot.app, 'evidence-chain-orchestrator');
  assert.equal(r.snapshot.version, 1);
  assert.equal(typeof r.snapshot.exportedAt, 'string');
  for (const e of r.snapshot.edges) {
    assert.deepEqual(Object.keys(e).sort(), ['from', 'to']);
  }
  const parsed = parseSnapshot(r.snapshot, NOW);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('unreachable');
  assert.equal(findCycle(parsed.cards.map((c) => c.id), parsed.edges), null);
});

test('分享：重复选择去重，保持首次出现顺序', () => {
  const evidence = makeEvidence(['a', 'b', 'c']);
  const r = buildShareSnapshot(evidence, [], ['c', 'c', 'a', 'c', 'b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.snapshot.evidence.map((e) => e.id), ['c', 'a', 'b']);
});

test('分享：空选择 / 非数组 / 含非字符串元素一律 400 拒绝', () => {
  const evidence = makeEvidence(['a']);
  const cases: unknown[] = [[], undefined, ['a', 1], 'a', null, {}];
  for (const input of cases) {
    const r = buildShareSnapshot(evidence, [], input, NOW);
    assert.equal(r.ok, false, `输入 ${JSON.stringify(input)} 应被拒绝`);
    if (r.ok) throw new Error('unreachable');
    assert.equal(r.status, 400);
  }
});

test('分享：未知 id 明确 404 拒绝，且不生成任何快照内容', () => {
  const evidence = makeEvidence(['a']);
  const r = buildShareSnapshot(evidence, [], ['a', 'nope'], NOW);
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.status, 404);
});

test('分享：未选卡片及其连线在文件中完全不出现（含直连隐藏节点的边）', () => {
  // a→b 都选；另有 a→x、x→y 均不选
  const evidence = makeEvidence(['a', 'b', 'x', 'y']);
  const full = makeEdges([['a', 'b'], ['a', 'x'], ['x', 'y']]);
  const r = buildShareSnapshot(evidence, full, ['a', 'b'], NOW);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  const text = JSON.stringify(r.snapshot);
  for (const hidden of ['x', 'y']) {
    assert.ok(!text.includes(`"${hidden}"`), `隐藏卡片 ${hidden} 的 id 不得泄露`);
  }
  assert.deepEqual(r.snapshot.edges, [{ from: 'a', to: 'b' }]);
});

test('分享：随机 DAG 子集上两两可达性与完整图恒等，且边集极小', () => {
  // 7 个节点、只允许 id 升序方向的一批边；枚举多种选点子集核对
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const evidence = makeEvidence(ids);
  const candidates: Array<[number, number]> = [
    [0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [1, 4], [5, 6], [0, 6],
  ];
  const selections = [
    ['a', 'c', 'e', 'g'],
    ['b', 'd', 'f'],
    ['a', 'g'],
    ['a', 'b', 'f', 'g'],
    ['c', 'd', 'e'],
    ids,
  ];
  for (let mask = 1; mask < 1 << candidates.length; mask += 51) {
    const full = makeEdges(candidates.filter((_, i) => mask & (1 << i)));
    for (const sel of selections) {
      const r = buildShareSnapshot(evidence, full, sel, NOW);
      assert.equal(r.ok, true);
      if (!r.ok) throw new Error('unreachable');
      assertReachEquivalence(full, r.snapshot, sel);
      assertEveryEdgeEssential(r.snapshot);
      // 导出边端点必须都是所选卡片
      const chosen = new Set(sel);
      for (const e of r.snapshot.edges) {
        assert.ok(chosen.has(e.from) && chosen.has(e.to));
      }
    }
  }
});
