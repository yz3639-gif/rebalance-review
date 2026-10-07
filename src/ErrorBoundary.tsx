import { Component, type ReactNode } from 'react';
import { download } from './records';

export default class ErrorBoundary extends Component<{ children: ReactNode; scope?: string; resetKey?: unknown }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; scope?: string; resetKey?: unknown }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return <div key={this.state.attempt} className="boundary-content">{this.props.children}</div>;
    return <section className="error recovery-panel" role="alert"><h2>This view could not finish.</h2>
      <p>{this.props.scope ? 'Your portfolio inputs and saved journal remain available. Retry this view or change the inputs.' : 'Saved reviews and opted-in drafts remain on this device. Retry the workbench, then restore your draft if available.'}</p>
      <div className="button-row"><button className="secondary" onClick={() => this.setState(s => ({ failed: false, attempt: s.attempt + 1 }))}>Retry {this.props.scope || 'workbench'}</button>
        <button className="quiet" onClick={() => download(JSON.stringify({ kind: 'render-failure', scope: this.props.scope || 'workbench', checkedAt: new Date().toISOString() }, null, 2), 'rebalance-diagnostic.json')}>Download diagnostic</button></div>
      <p className="hint">The diagnostic contains the view name and time only. It includes no portfolio, prices, API credentials or exception text, and is not sent anywhere.</p>
    </section>;
  }
}
