import { useMemo, useState } from 'react';
import type { ShareSnapshot } from '../types';

interface SharePreviewDialogProps {
  /** 已按最新图计算好的脱敏快照（预览请求的响应） */
  snapshot: ShareSnapshot;
  busy: boolean;
  /** 按最新图重新计算并下载文件（不重新勾选） */
  onDownload: () => void;
  onCancel: () => void;
}

/** 卡片 id → 标题（预览快照内只有所选卡片，标题即快照原值） */
function useTitles(snapshot: ShareSnapshot): Map<string, string> {
  return useMemo(() => new Map(snapshot.evidence.map((e) => [e.id, e.title])), [snapshot]);
}

export default function SharePreviewDialog({ snapshot, busy, onDownload, onCancel }: SharePreviewDialogProps) {
  const titles = useTitles(snapshot);
  const [showJson, setShowJson] = useState(false);
  const jsonText = useMemo(() => JSON.stringify(snapshot, null, 2), [snapshot]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal import-preview" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>外部分享 · 脱敏快照预览</h2>
        <p className="ip-hint">
          预览为只读，不会修改当前数据。文件仅包含勾选卡片（字段保持原值）与连接这些卡片的「必须早于」关系：
          任意两张所选卡片的先后可达关系与当前完整图一致——即使路径经过未勾选的隐藏卡片也会补出关系边，
          未勾选卡片的内容与 id 不会出现在文件中。文件沿用快照格式，可直接通过现有「导入 JSON」校验。
        </p>

        <div className="ip-summary">
          <span className="ip-tag add">公开卡片 {snapshot.evidence.length}</span>
          <span className="ip-tag add">导出连线 {snapshot.edges.length}</span>
        </div>

        <div className="ip-sections">
          <section className="ip-section ip-add">
            <div className="ip-section-static">
              <span className="ip-caret">▸</span>
              <span className="ip-section-title">将公开的证据卡片</span>
              <span className="ip-count">{snapshot.evidence.length}</span>
            </div>
            <div className="ip-section-body">
              <ul className="ip-list">
                {snapshot.evidence.map((card) => (
                  <li key={card.id}>
                    <span className="ip-card-title">{card.title}</span>
                    <span className="ip-card-id" title={card.id}>
                      {card.id.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="ip-section ip-remove">
            <div className="ip-section-static">
              <span className="ip-caret">▸</span>
              <span className="ip-section-title">导出的「必须早于」关系（含跨隐藏卡片补出的关系）</span>
              <span className="ip-count">{snapshot.edges.length}</span>
            </div>
            {snapshot.edges.length > 0 && (
              <div className="ip-section-body">
                <ul className="ip-list">
                  {snapshot.edges.map((e) => (
                    <li key={`${e.from}->${e.to}`}>
                      <span className="ip-edge">
                        {titles.get(e.from) ?? e.from.slice(0, 8)} <b>必须早于</b>{' '}
                        {titles.get(e.to) ?? e.to.slice(0, 8)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {snapshot.edges.length === 0 && (
              <div className="ip-section-body">
                <p className="muted">所选卡片之间没有先后可达关系（孤立卡片照常导出，不附连线）。</p>
              </div>
            )}
          </section>
        </div>

        <div className="share-json-toggle">
          <button type="button" className="btn small" onClick={() => setShowJson((v) => !v)}>
            {showJson ? '收起 JSON 原文' : '查看 JSON 原文'}
          </button>
        </div>
        {showJson && <pre className="share-json">{jsonText}</pre>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={onDownload} disabled={busy}>
            {busy ? '正在按最新图计算…' : '下载脱敏 JSON 快照'}
          </button>
        </div>
      </div>
    </div>
  );
}
