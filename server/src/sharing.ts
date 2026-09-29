import { findCycle, reachableSet, stableTopoOrder } from './graph';
import { parseSnapshot } from './importing';
import type { Edge, Evidence } from './types';

export const SHARE_APP = 'evidence-chain-orchestrator';
export const SHARE_VERSION = 1;

/** 脱敏分享快照：沿用现有快照格式（app/version/evidence/edges + from/to） */
export interface ShareSnapshot {
  app: string;
  version: number;
  exportedAt: string;
  evidence: Evidence[];
  edges: Array<{ from: string; to: string }>;
}

export type BuildShareResult =
  | { ok: true; snapshot: ShareSnapshot }
  | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * 规整并校验请求中的 id 列表：必须为字符串数组；重复选择去重；空选择明确拒绝。
 * 是否存在未知 id 由调用方对照当前卡片集合另行校验。
 */
export function normalizeSelectedIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') return null;
    if (seen.has(x)) continue; // 重复选择去重
    seen.add(x);
    ids.push(x);
  }
  if (ids.length === 0) return null;
  return ids;
}

/**
 * 构建脱敏分享快照（纯只读，不写数据库）。
 *
 * 规则：
 * - 所选卡片字段保持原值原样导出；未选卡片的记录及其节点 id 一律不出现在结果中
 *   （无 from/to 端点可引用它们，evidence 中也不含其任何字段）。
 * - 对任意两张所选卡片 u、v：导出图中 u 可达 v ⇔ 当前完整图中 u 可达 v，
 *   包括路径经过未选（隐藏）卡片的情形——可达关系按完整图计算，
 *   绝不能只截取原图中两端都在所选集合内的连线（隐藏路径会因此丢失）。
 * - 导出边仅连接所选卡片，且是该可达关系在所选集合上的**传递约简**：
 *   u→v 入图当且仅当 u 在完整图中可达 v，且不存在第三张所选卡片 w
 *   使 u 可达 w、w 再可达 v。因此移除任一条导出边都会破坏至少一对所选卡片
 *   的可达关系（该边两端本身即失去唯一可达路径），边集极小且（DAG 上）唯一。
 * - 孤立卡片（与任何卡片都没有可达关系）原样保留，只是没有导出边。
 *
 * 结果结构与 /api/export 完全一致，可直接通过现有导入解析与环校验
 * （导出图是完整 DAG 可达关系的子关系，必有无环）。
 */
export function buildShareSnapshot(
  evidence: Evidence[],
  edges: Edge[],
  rawIds: unknown,
  now: string = new Date().toISOString(),
): BuildShareResult {
  const ids = normalizeSelectedIds(rawIds);
  if (ids === null) {
    return { ok: false, status: 400, message: '请先勾选要公开的证据卡片（至少一张）' };
  }
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 404,
      message: `选择中包含 ${unknown.length} 张不存在的证据卡片，请刷新后重试`,
    };
  }

  const edgePairs: Array<{ fromId: string; toId: string }> = edges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
  }));
  const order = stableTopoOrder(
    evidence.map((e) => ({ id: e.id, createdAt: e.createdAt })),
    edgePairs,
  );
  if (!order) return { ok: false, status: 409, message: '当前约束图存在环，无法生成分享快照' };

  const selected = new Set(ids);
  const selectedInOrder = order.filter((id) => selected.has(id));
  const idx = new Map(selectedInOrder.map((id, i) => [id, i]));

  /* 对每张所选卡片在**完整图**上求一次可达集合（BFS 会经过未选卡片） */
  const reachBits = new Map<string, bigint>();
  for (const u of selectedInOrder) reachBits.set(u, reachableToSelected(edgePairs, u, idx));

  /*
   * 在所选集合上做传递约简。沿完整图拓扑序逆序处理（后继必然先于前驱完成）：
   * - 对每个出邻接点 v 维护保留边集合 keep[v]（BigInt 位集，存前驱位）；
   * - 已处理节点的可达并集 `union`（含自身位）刻画「经某个保留边的中间节点可达」；
   * - u→v 需要保留 ⇔ u 在完整图中可达 v，且 v 不在并集中
   *   （不存在所选中间 w：u 可达 w 且 w 可达 v）。
   * 处理完出边后把 u 的完整可达集合并入 union，供更前的前驱判定。
   */
  const keep = new Map<number, bigint>(selectedInOrder.map((_, i) => [i, 0n]));
  for (let i = selectedInOrder.length - 1; i >= 0; i--) {
    const u = selectedInOrder[i];
    const uBit = 1n << BigInt(i);
    const reach = reachBits.get(u)!;
    let union = uBit;
    for (let j = i + 1; j < selectedInOrder.length; j++) {
      const v = selectedInOrder[j];
      const vBit = 1n << BigInt(j);
      if ((reach & vBit) !== 0n && (union & vBit) === 0n) {
        keep.set(j, keep.get(j)! | uBit);
      }
      if ((reach & vBit) !== 0n) union |= reachBits.get(v)! | vBit;
    }
  }

  /* 收集导出边：仅连接所选卡片；按 (from 拓扑位置, to 拓扑位置) 确定序输出 */
  const exported: Array<{ from: string; to: string }> = [];
  for (const [j, bits] of keep) {
    if (bits === 0n) continue;
    const to = selectedInOrder[j];
    for (let i = 0; i < j; i++) {
      if ((bits & (1n << BigInt(i))) !== 0n) exported.push({ from: selectedInOrder[i], to });
    }
  }

  const snapshot: ShareSnapshot = {
    app: SHARE_APP,
    version: SHARE_VERSION,
    exportedAt: now,
    evidence: ids.map((id) => ({ ...byId.get(id)! })),
    edges: exported,
  };
  return { ok: true, snapshot };
}

/** 从 start 在完整图上 BFS，把可达的**所选**节点（不含自身）压成位集（位序 = idx） */
function reachableToSelected(
  edges: Array<{ fromId: string; toId: string }>,
  start: string,
  idx: Map<string, number>,
): bigint {
  let bits = 0n;
  for (const v of reachableSet(edges, start)) {
    if (v === start) continue;
    const p = idx.get(v);
    if (p !== undefined) bits |= 1n << BigInt(p);
  }
  return bits;
}

/**
 * 防御性自检：生成的分享快照必须能通过现有导入解析与环校验
 * （算法构造上必然成立；若返回 false 说明实现被破坏，调用方应拒绝下发）。
 */
export function assertShareSnapshotImportable(snapshot: ShareSnapshot): boolean {
  const parsed = parseSnapshot(snapshot, snapshot.exportedAt);
  if (!parsed.ok) return false;
  return findCycle(parsed.cards.map((c) => c.id), parsed.edges) === null;
}
