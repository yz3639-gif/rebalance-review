import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import MarketPulse from '../demo/MarketPulse';

// Keep the public graph free of the connected controller, providers and journal.
class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main role="alert" style={{ maxWidth: 640, padding: 32, margin: '10vh auto', color: '#edf1f7', fontFamily: 'system-ui' }}>
      <h1>The demo could not finish.</h1><p>Reload the synthetic study to retry. This demo does not store personal inputs or a review journal.</p>
      <button type="button" className="dr-button dr-button-primary" onClick={() => location.reload()}>Reload demo</button>{' '}
      <a href="https://github.com/yz3639-gif/rebalance-review">View source and local setup</a>
    </main>;
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode><DemoBoundary><MarketPulse /></DemoBoundary></StrictMode>,
);
