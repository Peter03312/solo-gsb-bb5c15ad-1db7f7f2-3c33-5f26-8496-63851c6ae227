import type { GraphState } from '../types';

interface SharePanelProps {
  state: GraphState;
  selected: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onPreview: () => void;
  onCancel: () => void;
}

/**
 * 脱敏分享面板：勾选要对外公开的证据卡片，预览并下载脱敏 JSON 快照。
 * 计算全部在服务端按当前最新图完成（只读），面板本身不推导任何可达关系。
 */
export default function SharePanel({ state, selected, busy, onToggle, onSelectAll, onClear, onPreview, onCancel }: SharePanelProps) {
  const all = state.evidence.map((e) => e.id);
  const allSelected = all.length > 0 && selected.size === all.length;

  return (
    <section className="share-panel">
      <div className="chain-head">
        <h2>外部分享 · 勾选公开证据</h2>
        <p className="muted">
          勾选要对外公开的证据卡片后点「预览脱敏快照」。所选卡片字段保持原值；未选卡片及其 id 不会出现在文件中。
          任意两张所选卡片的先后可达关系与当前完整图一致——即使路径经过未勾选卡片也会补出关系边，导出边仅连接所选卡片且每条都不可省略（不是简单截取原图连线）；孤立卡片照常保留。重复选择去重，空选择会被拒绝。全程只读，不修改数据库。
        </p>
      </div>

      {all.length === 0 ? (
        <div className="chain-summary muted">当前没有卡片可分享。</div>
      ) : (
        <>
          <div className="share-controls">
            <button type="button" className="btn small" onClick={allSelected ? onClear : onSelectAll} disabled={busy}>
              {allSelected ? '全部取消' : '全选'}（已选 {selected.size}/{all.length}）
            </button>
            <button type="button" className="btn small" onClick={onClear} disabled={busy || selected.size === 0}>
              清空选择
            </button>
            <span className="muted share-tip">在下方画布卡片上勾选 / 取消勾选（Esc 退出分享模式）</span>
          </div>
          <ul className="share-checklist">
            {state.evidence.map((ev) => (
              <li key={ev.id}>
                <label className="share-check-item">
                  <input
                    type="checkbox"
                    checked={selected.has(ev.id)}
                    disabled={busy}
                    onChange={() => onToggle(ev.id)}
                  />
                  <span className="share-check-title">{ev.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="modal-actions share-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          退出分享
        </button>
        <button type="button" className="btn primary" onClick={onPreview} disabled={busy || selected.size === 0}>
          预览脱敏快照
        </button>
      </div>
    </section>
  );
}
