import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { GraphState, ShareResult } from '../types';

interface SharePanelProps {
  state: GraphState;
  titleOf: (id: string) => string;
}

/**
 * 外部分享面板（只读，不写数据库）：
 * 勾选要公开的证据 → 服务端按**当前完整图**计算脱敏快照：
 * - 所选卡片字段保持原值；未选卡片及其节点标识不会出现在响应/文件中；
 * - 任意两张所选卡片的可达关系与完整图一致（路径可以经过未公开的隐藏卡片）；
 * - 导出边只连接所选卡片，且为限定可达关系的传递约简：每条导出边都不可或缺，
 *   不是原图连线的简单截取（原图直连已能绕行的会被剔除，跨隐藏卡可达的会补边）；
 * - 孤立卡保留；重复选择去重；空选择 / 未知 id 由服务端明确拒绝；
 * - 文件沿用完整快照 app / version / evidence / edges 与 from / to 字段，可通过现有导入校验。
 * 图或勾选变化后旧预览立即清除；下载总是携带最新勾选按最新图重新计算。
 */
export default function SharePanel({ state, titleOf }: SharePanelProps) {
  /** 当前勾选（去重集合，以有序数组保存保证渲染确定） */
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ShareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* 图一变化（卡片增删改、连线增删、导入、合并等带来新 state）：
     在绘制前同步清除旧预览与错误，并剔除已不存在的勾选；过期响应由请求序号拦截 */
  const seqRef = useRef(0);
  useLayoutEffect(() => {
    seqRef.current++;
    setPreview(null);
    setErr(null);
    setLoading(false);
    setDownloading(false);
    setSelected((cur) => {
      const ids = new Set(state.evidence.map((e) => e.id));
      return cur.filter((id) => ids.has(id));
    });
  }, [state]);

  /** 勾选变化：更新选择、使在途请求作废并清除旧预览（选择变化后旧快照不再可信） */
  const invalidate = () => {
    seqRef.current++;
    setLoading(false);
    setDownloading(false);
    setErr(null);
    setPreview(null);
  };

  const toggle = (id: string) => {
    invalidate();
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const selectAll = () => {
    invalidate();
    setSelected(state.evidence.map((e) => e.id));
  };

  const clearAll = () => {
    invalidate();
    setSelected([]);
  };

  const runPreview = async () => {
    if (selected.length === 0) {
      setErr('请至少勾选一张要公开的证据卡片');
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.sharePreview(selected);
      if (seq !== seqRef.current) return; // 图或选择已变化：丢弃过期响应
      setPreview(r);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setPreview(null);
      setErr(e instanceof ApiError ? e.message : '预览生成失败，请重试');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  /** 下载：携带最新勾选，由服务端按最新图当场重新计算，绝不使用旧预览缓存 */
  const runDownload = async () => {
    if (selected.length === 0) {
      setErr('请至少勾选一张要公开的证据卡片');
      return;
    }
    const seq = ++seqRef.current;
    setDownloading(true);
    setErr(null);
    try {
      const blob = await api.shareDownload(selected);
      if (seq !== seqRef.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'evidence-share.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (seq !== seqRef.current) return;
      // 未知 id / 图已变化等：清除旧预览并提示重新勾选
      setPreview(null);
      setErr(e instanceof ApiError ? e.message : '下载失败，请重试');
    } finally {
      if (seq === seqRef.current) setDownloading(false);
    }
  };

  /** 原图直连集合：用于标注「跨隐藏卡片补出」的导出边 */
  const originalEdges = useMemo(
    () => new Set(state.edges.map((e) => `${e.fromId}->${e.toId}`)),
    [state.edges],
  );

  const fmtTime = (iso: string | null): string => (iso ? iso.replace('T', ' ').slice(0, 16) : '（无发生时间）');

  return (
    <section className="share-panel">
      <div className="share-head">
        <h2>对外分享（脱敏快照）</h2>
        <p className="muted">
          勾选要公开的证据并预览 / 下载脱敏 JSON：所选卡片字段保持原值，<b>未选卡片及其节点标识不会出现在文件中</b>；任意两张所选卡片的先后可达关系与当前完整图一致（允许依据路径经过未公开的隐藏卡片），导出连线只连接所选卡片且每条都不可或缺，并非原图连线的简单截取；孤立卡保留。生成过程只读、不写数据库，文件可直接通过「导入 JSON」校验。图或勾选变化后旧预览自动清除。
        </p>
      </div>

      <div className="share-toolbar">
        <button type="button" className="btn small" onClick={selectAll} disabled={state.evidence.length === 0}>
          全选（{state.evidence.length}）
        </button>
        <button type="button" className="btn small" onClick={clearAll} disabled={selected.length === 0}>
          清空勾选
        </button>
        <span className="share-count">已勾选 <b>{selected.length}</b> 张</span>
        <button type="button" className="btn small primary" onClick={() => void runPreview()} disabled={selected.length === 0 || loading}>
          {loading ? '计算中…' : '预览脱敏快照'}
        </button>
        <button type="button" className="btn small primary" onClick={() => void runDownload()} disabled={selected.length === 0 || downloading}>
          {downloading ? '生成中…' : '下载脱敏 JSON'}
        </button>
      </div>

      <ul className="share-pick-list">
        {state.evidence.map((ev) => (
          <li key={ev.id}>
            <label className={`share-pick${selected.includes(ev.id) ? ' checked' : ''}`}>
              <input type="checkbox" checked={selected.includes(ev.id)} onChange={() => toggle(ev.id)} />
              <span className="share-pick-title">{ev.title}</span>
              <span className="share-pick-meta">
                🕒 {fmtTime(ev.occurredAt)}
                {ev.source && <> · 来源 · {ev.source}</>}
              </span>
            </label>
          </li>
        ))}
        {state.evidence.length === 0 && <li className="muted share-empty">当前没有卡片可分享。</li>}
      </ul>

      {err && <div className="order-error">⚠ {err}</div>}

      {preview && (
        <div className="share-preview">
          <div className="share-summary">
            将公开 <b>{preview.counts.cards}</b> 张卡片、<b>{preview.counts.edges}</b> 条导出连线；
            其余卡片与连线已全部剔除，响应与文件中不含它们的任何标识。
          </div>

          <div className="share-preview-cols">
            <div>
              <div className="share-subtitle">公开卡片（字段保持原值）：</div>
              <ul className="share-card-list">
                {preview.snapshot.evidence.map((ev) => (
                  <li key={ev.id}>
                    <b>{ev.title}</b>
                    <div className="muted">🕒 {fmtTime(ev.occurredAt)}{ev.source && <> · 来源 · {ev.source}</>}</div>
                    {ev.description && <div className="share-desc">{ev.description}</div>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="share-subtitle">导出连线（可达关系与完整图一致）：</div>
              {preview.snapshot.edges.length === 0 ? (
                <div className="muted">无导出连线（所选卡片互相不可达，或均为孤立卡）。</div>
              ) : (
                <ul className="share-edge-list">
                  {preview.snapshot.edges.map((e, i) => {
                    const viaHidden = !originalEdges.has(`${e.from}->${e.to}`);
                    return (
                      <li key={`${e.from}->${e.to}`} className={viaHidden ? 'via-hidden' : ''}>
                        <span className="share-edge-index">{i + 1}</span>
                        {titleOf(e.from)} → {titleOf(e.to)}
                        {viaHidden && <span className="share-edge-tag" title="完整图中两卡没有直连，其先后关系经由未公开的隐藏卡片建立，导出时补一条仅连接所选卡片的连线">跨隐藏卡补连</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <details className="share-json">
            <summary>查看脱敏 JSON 原文</summary>
            <pre>{JSON.stringify(preview.snapshot, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
