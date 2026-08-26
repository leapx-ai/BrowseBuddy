/*
 * Component gallery. Development-only entry (see webpack.config.js) whose job is
 * to make "the whole UI" reviewable in one screen: every specimen is rendered
 * twice, dark and light, at the real 400px popup width, and the token set can be
 * swapped between candidate directions from the toolbar.
 *
 * It renders class names, not the real modules. The modules need chrome.* and
 * live history data, and 86 of their visual decisions still sit in inline
 * style={{}} props - which is precisely what makes a global restyle impossible
 * today. As those move into classes, this page becomes the spec they match.
 */
import React, { useState } from 'react';
import '../popup/styles.css';
import './styleguide.css';

const DIRECTIONS = [
  { id: 'density', label: 'A 密度优先（当前令牌）' },
  { id: 'soft', label: 'B 柔和中性' },
  { id: 'contrast', label: 'C 高对比' },
];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="sg-section">
    <h3>{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="sg-row">{children}</div>
);

// One history row, so the list specimen below stays readable.
const ListRow: React.FC<{
  title: string;
  url: string;
  time: string;
  fav?: boolean;
  hover?: boolean;
}> = ({ title, url, time, fav = false, hover = false }) => (
  <div className={`history-item ${hover ? 'sg-hover' : ''}`}>
    <div className="history-favicon" style={{ background: '#5b6bbf', color: '#fff' }}>
      G
    </div>
    <div className="history-content">
      <div className="history-title">{title}</div>
      <div className="history-url">{url}</div>
    </div>
    <div className="history-meta">
      <span className="history-time">{time}</span>
      <span className={`fav-btn ${fav ? 'fav-btn-active' : ''}`}>{fav ? '★' : '☆'}</span>
    </div>
  </div>
);

const Gallery: React.FC = () => (
  <>
    <Section title="表面与文字">
      <div className="sg-swatches">
        <div className="sg-swatch" style={{ background: 'var(--bg-primary)' }}>bg-primary</div>
        <div className="sg-swatch" style={{ background: 'var(--bg-secondary)' }}>bg-secondary</div>
        <div className="sg-swatch" style={{ background: 'var(--bg-card)' }}>bg-card</div>
        <div className="sg-swatch" style={{ background: 'var(--bg-tertiary)' }}>bg-tertiary</div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ color: 'var(--text-primary)' }}>text-primary 正文</div>
        <div style={{ color: 'var(--text-secondary)' }}>text-secondary 次要说明</div>
        <div style={{ color: 'var(--text-muted)' }}>text-muted 弱化信息</div>
      </div>
    </Section>

    <Section title="按钮">
      <Row>
        <button className="btn btn-primary">主操作</button>
        <button className="btn btn-secondary">次操作</button>
        <button className="btn btn-danger">删除</button>
      </Row>
      <Row>
        <button className="btn btn-primary btn-sm">小号</button>
        <button className="btn btn-secondary btn-sm">小号</button>
        <button className="btn btn-primary" disabled>禁用</button>
      </Row>
      <Row>
        <button className="btn btn-primary btn-block sg-hover">整宽主操作（hover）</button>
      </Row>
      <Row>
        <button className="btn btn-primary btn-sm">
          <span className="spinner" style={{ width: 12, height: 12 }} /> 处理中
        </button>
      </Row>
    </Section>

    <Section title="输入">
      <div className="input-group">
        <label className="input-label">网址或域名</label>
        <input className="input" placeholder="example.com" />
      </div>
      <div className="input-group">
        <input className="input" defaultValue="已填写的值" />
      </div>
      <label className="checkbox-wrapper">
        <input type="checkbox" className="checkbox-input" defaultChecked />
        <span className="checkbox-label">同时删除已存在的记录</span>
      </label>
    </Section>
    <Section title="导航与分段控件">
      <div className="nav">
        <button className="nav-item active">浏览</button>
        <button className="nav-item">统计</button>
        <button className="nav-item sg-hover">隐私（hover）</button>
        <button className="nav-item">删除</button>
      </div>
      <div className="segmented" style={{ marginTop: 8 }}>
        <button className="segmented-item active">列表</button>
        <button className="segmented-item">按域名</button>
        <button className="segmented-item">日历</button>
      </div>
    </Section>

    <Section title="工具条与结果栏">
      <div className="toolbar">
        <input className="input" placeholder="搜索标题或网址" />
        <button className="icon-btn" aria-label="筛选">⚲</button>
        <button className="icon-btn icon-btn-dot" aria-label="筛选（有筛选生效）">⚲</button>
      </div>
      <div className="result-bar">
        <span className="result-count">128 条记录 · 37 个网站</span>
        <span className="chip">
          类型：链接跳转
          <button className="chip-clear" aria-label="清除">×</button>
        </span>
      </div>
    </Section>

    <Section title="历史列表（含吸顶日期锚点）">
      <div className="history-list">
        <div className="list-date-header">
          <span>今天</span>
          <span className="list-date-count">12 条</span>
        </div>
        <ListRow title="GitHub - 一个很长的仓库标题会被截断处理" url="github.com/user/repo" time="14:32" />
        <ListRow title="悬停态：整行可点，星标出现" url="developer.mozilla.org/zh-CN" time="13:05" hover />
        <ListRow title="已收藏的记录" url="news.ycombinator.com" time="09:41" fav />
        <div className="list-date-header">
          <span>昨天</span>
          <span className="list-date-count">8 条</span>
        </div>
        <ListRow title="前一天的第一条" url="example.com/very/long/path/that/overflows" time="22:18" />
      </div>
      <button className="list-expander">展开全部 128 条</button>
    </Section>
    <Section title="卡片与指标">
      <div className="card">
        <div className="card-title">每日趋势 · 最近 30 天</div>
        <div className="chart-bar" style={{ height: 40, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {[8, 22, 14, 33, 27, 40, 18].map((h, i) => (
            <div
              key={i}
              style={{ flex: 1, height: `${h}px`, background: 'var(--primary-color)', borderRadius: '2px 2px 0 0' }}
            />
          ))}
        </div>
        <div className="card-hint">柱子高度按当日记录数归一</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">1,284</div>
          <div className="stat-label">总记录</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">213</div>
          <div className="stat-label">访问网站</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">26</div>
          <div className="stat-label">活跃天数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">49</div>
          <div className="stat-label">日均记录</div>
        </div>
      </div>
    </Section>

    <Section title="进度与占比">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: '72%' }} />
      </div>
      <div className="progress-bar" style={{ marginTop: 6 }}>
        <div className="progress-fill progress-fill-secondary" style={{ width: '38%' }} />
      </div>
    </Section>
    <Section title="日历热力图">
      <div className="calendar-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={`e${i}`} className="calendar-cell calendar-cell-empty" />
        ))}
        <div className="calendar-cell">1</div>
        <div className="calendar-cell" style={{ background: 'rgba(99,102,241,0.35)' }}>2</div>
        <div className="calendar-cell" style={{ background: 'rgba(99,102,241,0.7)' }}>3</div>
        <div className="calendar-cell calendar-cell-today">4</div>
        <div className="calendar-cell calendar-cell-selected">5</div>
      </div>
      <div className="heatmap-legend">
        <span>少</span>
        <span className="heatmap-swatch" />
        <span className="heatmap-swatch" style={{ background: 'rgba(99,102,241,0.35)' }} />
        <span className="heatmap-swatch" style={{ background: 'rgba(99,102,241,0.7)' }} />
        <span>多</span>
      </div>
    </Section>

    <Section title="条目与提示">
      <div className="blacklist-item">
        <span className="blacklist-pattern">example.com</span>
        <span className="blacklist-type">精确</span>
        <button className="btn btn-danger btn-sm">移除</button>
      </div>
      <div className="alert alert-info" style={{ marginTop: 8 }}>删除操作不可撤销。</div>
      <div className="alert alert-success">已加入黑名单。</div>
      <div className="alert alert-warning">该规则会匹配大量记录。</div>
      <details className="disclosure">
        <summary className="disclosure-summary">使用说明</summary>
        <div className="disclosure-body">折叠起来的静态说明，展开后才占纵向空间。</div>
      </details>
    </Section>
    <Section title="空状态：emoji 现状 vs 线性图标提案">
      <div className="empty-state">
        <div className="empty-icon">📭</div>
        <div className="empty-title">没有找到记录</div>
        <div className="empty-desc">换个关键词，或清除筛选条件</div>
      </div>
      <div className="empty-state">
        <div className="empty-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Z" />
            <path d="M3 8l3-4h12l3 4M9 12h6" />
          </svg>
        </div>
        <div className="empty-title">没有找到记录</div>
        <div className="empty-desc">线性图标随 currentColor 变化，两个主题下都不跑色</div>
      </div>
    </Section>

    <Section title="加载">
      <div className="loading">
        <div className="spinner" />
      </div>
    </Section>

    <Section title="确认弹窗（就地展示，未套 overlay）">
      <div className="modal-content" style={{ position: 'static', transform: 'none' }}>
        <h3 className="modal-title">删除 128 条记录？</h3>
        <div className="preview-list">
          <div className="preview-item">github.com/user/repo</div>
          <div className="preview-item">news.ycombinator.com</div>
          <div className="preview-more">另有 126 条</div>
        </div>
        <label className="checkbox-wrapper">
          <input type="checkbox" className="checkbox-input" />
          <span className="checkbox-label">同时加入黑名单</span>
        </label>
        <div className="modal-actions">
          <button className="btn btn-secondary">取消</button>
          <button className="btn btn-danger">删除</button>
        </div>
      </div>
    </Section>

    <Section title="页脚">
      <footer className="footer">数据仅保存在本地，不会上传</footer>
    </Section>
  </>
);

export default function App() {
  const [direction, setDirection] = useState('density');
  return (
    <div className="sg-root" data-direction={direction}>
      <div className="sg-bar">
        <h1>BrowseBuddy 组件总览</h1>
        <label>
          风格方向
          <select value={direction} onChange={e => setDirection((e.target as HTMLSelectElement).value)}>
            {DIRECTIONS.map(d => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="sg-note">
        左右两栏是同一批组件在深色与浅色下的表现，宽度与真实弹窗一致（400px）。切换风格方向只改
        令牌，不改任何组件代码。标注「hover」的样本是用同名声明模拟出来的静态效果，真实交互仍需在
        浏览器里确认。
      </p>
      <div className="sg-panels">
        <section className="sg-panel">
          <div className="sg-panel-label">深色（默认）</div>
          <div className="sg-panel-body">
            <Gallery />
          </div>
        </section>
        <section className="sg-panel" data-theme="light">
          <div className="sg-panel-label">浅色</div>
          <div className="sg-panel-body">
            <Gallery />
          </div>
        </section>
      </div>
    </div>
  );
}
