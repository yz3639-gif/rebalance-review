import { useId, useMemo, useState } from 'react';
import { DEMO_SYMBOLS, ETF_REGISTRY } from './data/registry';

/** Bounded suggestions keep a large catalog accessible without mounting thousands of options. */
export default function AssetSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    const query = value.trim().toUpperCase();
    const assets = ETF_REGISTRY.filter(e => query ? e.symbol.includes(query) || e.name.toUpperCase().includes(query) : DEMO_SYMBOLS.includes(e.symbol));
    assets.sort((a, b) => Number(b.symbol === query) - Number(a.symbol === query) || Number(b.symbol.startsWith(query)) - Number(a.symbol.startsWith(query)) || a.symbol.localeCompare(b.symbol));
    const found = assets.slice(0, 12).map(e => ({ symbol: e.symbol, name: e.name }));
    if (!query || 'CASH'.includes(query) || 'USD CASH'.includes(query)) {
      const cash = { symbol: 'CASH', name: 'USD cash · modeled at 0% return' };
      // USD is also a real ETF ticker. Exact fund matches must stay ahead of cash suggestions.
      if (found.some(e => e.symbol === query)) found.push(cash); else found.unshift(cash);
    }
    return found.slice(0, 12);
  }, [value]);
  function choose(symbol: string) { onChange(symbol); setOpen(false); setActive(0); }
  return <div className="asset-search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <input aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
      placeholder="Ticker or fund name" maxLength={100} value={value} onFocus={() => { setOpen(true); setActive(0); }}
      onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); setActive(0); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { setOpen(false); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => options.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0); }
        if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active].symbol); }
      }}/>
    {open && <div className="asset-options" id={`${id}-list`} role="listbox" aria-label={`${label} matches`}>
      {options.map((entry, i) => <div role="option" aria-selected={active === i} id={`${id}-${i}`} key={entry.symbol} className={active === i ? 'active' : ''}
        onMouseDown={e => e.preventDefault()} onClick={() => choose(entry.symbol)}><strong>{entry.symbol}</strong><span>{entry.name}</span></div>)}
      {!options.length && <p>No matching ETF. An unmatched ticker remains visible for coverage review.</p>}
      <p className="hint">Up to 12 matches. Refine by code or name. Listing does not guarantee price history.</p>
    </div>}
  </div>;
}
