import './terminal-preview.css';

const allocation = [
  { symbol: 'SPY', name: 'US equity', current: 60, proposed: 45 },
  { symbol: 'BND', name: 'US bonds', current: 30, proposed: 40 },
  { symbol: 'GLD', name: 'Gold', current: 10, proposed: 15 },
];
const plot = { left: 56, width: 320, top: 21, row: 43 };

/** Fixed allocation illustration only: no market prices or performance estimates. */
export default function TerminalPreview() {
  return <section className="terminal-preview" aria-label="Illustrative allocation comparison">
    <div className="terminal-preview__topline">
      <span className="terminal-preview__label"><span className="terminal-preview__mark" aria-hidden="true"><i /><i /><i /><i /></span>MODEL PREVIEW</span>
      <span className="terminal-preview__badge">ILLUSTRATION</span>
    </div>

    <div className="terminal-preview__heading">
      <div><h2>See the allocation shift.</h2></div>
      <span className="terminal-preview__currency">ETF<br /><strong>USD</strong></span>
    </div>

    <div className="terminal-preview__portfolios">
      <div className="terminal-preview__portfolio terminal-preview__portfolio--a"><span><b>A</b> Current</span><small>100% allocated</small></div>
      <div className="terminal-preview__portfolio terminal-preview__portfolio--b"><span><b>B</b> Proposed</span><small>100% allocated</small></div>
    </div>

    <div className="terminal-preview__plot">
      <div className="terminal-preview__plot-label"><span>ALLOCATION WEIGHTS</span><span>% OF PORTFOLIO</span></div>
      <svg viewBox="0 0 392 159" aria-hidden="true" focusable="false">
        {[0, 25, 50, 75, 100].map(tick => <g key={tick}>
          <line x1={plot.left + tick / 100 * plot.width} y1="7" x2={plot.left + tick / 100 * plot.width} y2="136" className="terminal-preview__gridline" />
          <text x={plot.left + tick / 100 * plot.width} y="153" textAnchor="middle" className="terminal-preview__axis">{tick}</text>
        </g>)}
        {allocation.map((asset, index) => <g key={asset.symbol}>
          <text x="0" y={plot.top + index * plot.row + 8} className="terminal-preview__ticker">{asset.symbol}</text>
          <rect x={plot.left} y={plot.top + index * plot.row - 5} width={asset.current / 100 * plot.width} height="8" rx="1" className="terminal-preview__bar-a" />
          <rect x={plot.left} y={plot.top + index * plot.row + 8} width={asset.proposed / 100 * plot.width} height="8" rx="1" className="terminal-preview__bar-b" />
        </g>)}
      </svg>
    </div>

    <table className="terminal-preview__table">
      <caption>Illustrative allocation weights and changes, in percentage points.</caption>
      <thead><tr><th scope="col">Asset</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Change</th></tr></thead>
      <tbody>{allocation.map(asset => {
        const delta = asset.proposed - asset.current;
        return <tr key={asset.symbol}><th scope="row"><strong>{asset.symbol}</strong><span>{asset.name}</span></th><td>{asset.current}%</td><td>{asset.proposed}%</td><td className="terminal-preview__delta">{delta > 0 ? '+' : '−'}{Math.abs(delta)} <small>pp</small></td></tr>;
      })}</tbody>
    </table>

    <div className="terminal-preview__footer"><p>Illustrative weights only.<br />Run a review to calculate historical risk.</p><span><small>RISK METHOD</small><span aria-label="Portfolio variance: w transpose Sigma w">wᵀΣw</span></span></div>
  </section>;
}
