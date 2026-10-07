import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Code2,
  Layers3,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import {
  getReplayFrame,
  MARKET_ASSETS,
  REPLAY_INITIAL_STEP,
  REPLAY_LAST_STEP,
  REPLAY_META,
} from "./replayFeed";
import { PulseChart, Sparkline } from "./PulseChart";
import { RebalancePanel, usePulseStudy } from "./RebalancePanel";
import { createDefaultAllocationDraft } from "./allocationDraft";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./market.css";
import "./allocation.css";

const Research = lazy(() => import("../design/DesignApp"));
const MarketEmbed = lazy(() => import("./MarketEmbed"));
const REPO = "https://github.com/yz3639-gif/rebalance-review";
const price = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const change = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}%`;
const time = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: REPLAY_META.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(v));
const count = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
const positive = (v: number) => (v >= 0 ? "mp-positive" : "mp-negative");

export default function MarketPulse() {
  const [view, setView] = useState<"pulse" | "rebalance" | "research">("pulse");
  const [mode, setMode] = useState<"replay" | "market">("replay");
  const [step, setStep] = useState(REPLAY_INITIAL_STEP);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [speed, setSpeed] = useState(1),
    [visible, setVisible] = useState(!document.hidden);
  const [symbol, setSymbol] = useState("SPY"),
    [query, setQuery] = useState("");
  const [group, setGroup] = useState("All assets"),
    [sort, setSort] = useState<"default" | "change">("default");
  const [range, setRange] = useState<"30m" | "1h" | "all">("all"),
    [area, setArea] = useState(true);
  const [inspect, setInspect] = useState<string | null>(null),
    [showTable, setShowTable] = useState(false);
  const [controls, setControls] = useState(() => ({
    presetId: "core",
    bps: 5,
    nav: 100000,
    riskWindow: 252,
    allocations: createDefaultAllocationDraft(),
  }));
  const { snapshot, error, retry } = usePulseStudy();
  const frame = useMemo(() => getReplayFrame(step), [step]);
  const quote = frame.quotes.find((q) => q.symbol === symbol)!;
  const selectedPoint = inspect
    ? quote.history.find((p) => p.timestamp === inspect)
    : null;
  const inspectedChange = selectedPoint
    ? (selectedPoint.price / quote.previousClose - 1) * 100
    : quote.changePct;
  const searchRef = useRef<HTMLInputElement>(null);
  const running =
    playing && visible && view === "pulse" && mode === "replay" && !frame.ended;
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setStep((v) => Math.min(REPLAY_LAST_STEP, v + 1)),
      1100 / speed,
    );
    return () => clearInterval(timer);
  }, [running, speed]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInspect(null);
        setShowTable(false);
      }
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (motion.matches) setPlaying(false);
    };
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  const select = (s: string) => {
    if (MARKET_ASSETS.some((a) => a.symbol === s)) {
      setSymbol(s);
      setInspect(null);
    }
  };
  const filtered = useMemo(() => {
    const list = frame.quotes.filter(
      (q) =>
        (group === "All assets" || q.sleeve === group) &&
        `${q.symbol} ${q.name} ${q.shortName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    return sort === "change"
      ? [...list].sort(
          (a, b) =>
            b.changePct - a.changePct || a.symbol.localeCompare(b.symbol),
        )
      : list;
  }, [frame, query, group, sort]);
  const reset = () => {
    setStep(REPLAY_INITIAL_STEP);
    setPlaying(false);
    setSpeed(1);
    setSymbol("SPY");
    setQuery("");
    setGroup("All assets");
    setSort("default");
    setRange("all");
    setArea(true);
    setInspect(null);
    setShowTable(false);
  };
  const navigate = (next: typeof view) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const ticket = (compact: boolean) => (
    <RebalancePanel
      snapshot={snapshot}
      compact={compact}
      controls={controls}
      onControls={setControls}
      onExpand={() => navigate("rebalance")}
      onResearch={() => navigate("research")}
      studyError={error}
      onRetryStudy={retry}
    />
  );

  const replayControls = (
    <section className="mp-replay-controls" aria-label="Replay controls">
      <div className="mp-replay-state">
        <span className={`mp-status-dot ${running ? "is-running" : ""}`} />
        <b>
          {frame.ended
            ? "SESSION COMPLETE"
            : running
              ? "REPLAY RUNNING"
              : "REPLAY PAUSED"}
        </b>
        <span>30 simulated seconds / step</span>
      </div>
      <div className="mp-player">
        <button
          className="mp-play"
          aria-label={running ? "Pause replay" : "Play replay"}
          onClick={() => {
            if (frame.ended) setStep(0);
            setInspect(null);
            setPlaying((v) => !v || frame.ended);
          }}
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <label className="mp-scrubber">
          <span>10:33</span>
          <input
            type="range"
            aria-label="Replay position"
            min={0}
            max={REPLAY_LAST_STEP}
            step={1}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setInspect(null);
              setStep(Number(e.target.value));
            }}
          />
          <span>16:00 ET</span>
        </label>
        <label>
          <select
            aria-label="Replay speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[1, 2, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <button
          className="mp-icon"
          aria-label="Reset replay and view"
          title="Reset replay and view"
          onClick={reset}
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </section>
  );

  if (view === "research")
    return (
      <div className="mp-research-shell">
        <div className="mp-research-return">
          <button onClick={() => navigate("pulse")}>
            <ArrowLeft size={16} /> Market Pulse
          </button>
          <span>
            FROZEN HISTORICAL STUDY <i /> Independent of the quote display
          </span>
          <button onClick={() => navigate("rebalance")}>
            A → B transition <ArrowRight size={15} />
          </button>
        </div>
        <Suspense
          fallback={
            <div className="mp-loading">Loading research workspace…</div>
          }
        >
          <Research publicDemo />
        </Suspense>
      </div>
    );
  return (
    <div className="mp-app" data-testid="market-pulse" data-step={step}>
      <a className="mp-skip" href="#mp-main">
        Skip to workspace
      </a>
      <header className="mp-header">
        <button
          className="mp-brand"
          onClick={() => navigate("pulse")}
          aria-label="Rebalance Review home"
        >
          <span className="mp-brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            rebalance<span className="mp-brand-light"> / review</span>
            <small>THE ALLOCATION WORKSPACE</small>
          </span>
        </button>
        <nav aria-label="Demo workspace">
          <button
            className={view === "pulse" ? "active" : ""}
            onClick={() => navigate("pulse")}
          >
            <Radio size={15} /> Market Pulse
          </button>
          <button
            className={view === "rebalance" ? "active" : ""}
            onClick={() => navigate("rebalance")}
          >
            <SlidersHorizontal size={15} /> Rebalance
          </button>
          <button onClick={() => navigate("research")}>
            <Layers3 size={15} /> Research <ArrowUpRight size={12} />
          </button>
        </nav>
        <div className="mp-header-actions">
          <a
            className="mp-source-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
          >
            <Code2 size={17} />
          </a>
          <a
            className="mp-local-link"
            href={`${REPO}#quick-start`}
            target="_blank"
            rel="noreferrer"
          >
            Use your portfolio <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      {(mode === "replay" || view === "rebalance") && (
        <div
          role="region"
          className={`mp-ticker-tape ${running ? "is-running" : ""}`}
          aria-label="Synthetic ticker strip"
        >
          <span className="mp-tape-label">
            <i /> SYNTHETIC
            <br />
            REPLAY
          </span>
          <div className="mp-tape-window">
            <div className="mp-tape-track">
              {[0, 1].map((copy) => (
                <div
                  className="mp-tape-copy"
                  key={copy}
                  aria-hidden={copy === 1}
                >
                  {frame.quotes.slice(0, 16).map((q) => (
                    <button
                      key={q.symbol}
                      tabIndex={copy ? -1 : 0}
                      onClick={() => {
                        select(q.symbol);
                        setMode("replay");
                        navigate("pulse");
                      }}
                    >
                      <b>{q.symbol}</b>
                      <span>{price(q.price)}</span>
                      <span className={positive(q.changePct)}>
                        {change(q.changePct)}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <main id="mp-main" className="mp-main">
        <div className="mp-heading">
          <div>
            <div className="mp-eyebrow">
              <span className="mp-tiny-line" /> PORTFOLIO INTELLIGENCE /{" "}
              {view === "rebalance" ? "DECISION LAB" : "MARKET PULSE"}
            </div>
            <h1>
              {view === "rebalance"
                ? "From allocation to action."
                : "A moving market. A clearer decision."}
            </h1>
            <p>
              {view === "rebalance"
                ? "Understand the trades, costs and active risk before changing your portfolio."
                : "Follow 50 ETFs. Explore the change. Know what a rebalance would mean."}
            </p>
          </div>
          <div className="mp-heading-right">
            {view === "pulse" ? (
              <>
                <div
                  className="mp-mode-switch"
                  role="group"
                  aria-label="Data mode"
                >
                  <button
                    aria-pressed={mode === "replay"}
                    onClick={() => setMode("replay")}
                  >
                    Replay <span>SIMULATED</span>
                  </button>
                  <button
                    aria-pressed={mode === "market"}
                    onClick={() => setMode("market")}
                  >
                    Market <ExternalLink size={12} />
                  </button>
                </div>
                <span className="mp-mode-description">
                  {mode === "replay"
                    ? "Generated prices · fixed demo session"
                    : "TradingView embeds · delay varies by venue"}
                </span>
              </>
            ) : (
              <button
                className="mp-secondary"
                onClick={() => navigate("pulse")}
              >
                <ArrowLeft size={15} /> Back to pulse
              </button>
            )}
          </div>
        </div>
        {view === "rebalance" ? (
          <div className="mp-full-ticket">{ticket(false)}</div>
        ) : mode === "market" ? (
          <div className="mp-external-mode">
            <div className="mp-market-intro">
              <Radio size={19} />
              <p>
                <strong>Observed markets, in a separate view.</strong> Loading
                this mode connects to TradingView. Venue coverage and delay are
                set by the provider; embedded quotes do not feed the synthetic
                research study.
              </p>
            </div>
            <div className="mp-market-edit-layout">
              <Suspense
                fallback={
                  <div className="mp-loading">Loading market widgets…</div>
                }
              >
                <MarketEmbed symbol={symbol} onSymbolSelect={select} />
              </Suspense>
              <div className="mp-decision-panel mp-panel">{ticket(true)}</div>
            </div>
            <button className="mp-secondary" onClick={() => setMode("replay")}>
              Return to the interactive replay <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <>
            <div
              className="mp-benchmarks"
              role="group"
              aria-label="Synthetic benchmark watch"
            >
              <span className="mp-bench-label">
                AT A GLANCE<small>Demo session</small>
              </span>
              {["SPY", "QQQ", "IWM", "TLT"].map((s) => {
                const q = frame.quotes.find((x) => x.symbol === s)!;
                return (
                  <button
                    key={s}
                    className={`mp-benchmark ${s === symbol ? "is-selected" : ""}`}
                    onClick={() => select(s)}
                    aria-pressed={s === symbol}
                  >
                    <div>
                      <b>{s}</b>
                      <span>{q.shortName}</span>
                      <strong>{price(q.price)}</strong>
                    </div>
                    <div>
                      <span className={positive(q.changePct)}>
                        {q.changePct >= 0 ? (
                          <ArrowUpRight size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )}
                        {change(q.changePct)}
                      </span>
                      <Sparkline
                        values={q.history.map((p) => p.price)}
                        positive={q.changePct >= 0}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mp-mobile-playback">{replayControls}</div>
            <div className="mp-grid">
              <section
                className="mp-watchlist mp-panel"
                aria-label="ETF watchlist"
              >
                <div className="mp-panel-head">
                  <h2>
                    Watchlist <span>50</span>
                  </h2>
                  <button
                    className="mp-icon"
                    title="Sort by session change"
                    aria-label="Sort by session change"
                    aria-pressed={sort === "change"}
                    onClick={() =>
                      setSort((s) => (s === "default" ? "change" : "default"))
                    }
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
                <label className="mp-search">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    type="search"
                    aria-label="Search 50 ETFs"
                    placeholder="Search ticker or name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <kbd>/</kbd>
                </label>
                <label className="mp-group-select">
                  <select
                    aria-label="Asset group"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option>All assets</option>
                    {frame.groups.map((g) => (
                      <option key={g.sleeve}>{g.sleeve}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} />
                </label>
                <div className="mp-watch-columns">
                  <span>ASSET / USD</span>
                  <span>SESSION %</span>
                </div>
                <div className="mp-watch-scroll">
                  {filtered.map((q) => (
                    <button
                      className={`mp-watch-row ${symbol === q.symbol ? "is-selected" : ""}`}
                      key={q.symbol}
                      aria-pressed={symbol === q.symbol}
                      onClick={() => select(q.symbol)}
                    >
                      <span
                        className="mp-asset-dot"
                        style={{ background: q.color }}
                      />
                      <span className="mp-asset-id">
                        <b>{q.symbol}</b>
                        <small>{q.shortName}</small>
                      </span>
                      <Sparkline
                        values={q.history
                          .filter(
                            (_, i, arr) => i % 4 === 0 || i === arr.length - 1,
                          )
                          .map((p) => p.price)}
                        positive={q.changePct >= 0}
                      />
                      <span className="mp-quote-values">
                        <b
                          className={
                            q.updated && q.delta !== 0 && running
                              ? q.delta >= 0
                                ? "mp-tick-up"
                                : "mp-tick-down"
                              : ""
                          }
                          key={`${q.symbol}-${q.updatedAt}`}
                        >
                          {price(q.price)}
                        </b>
                        <small className={positive(q.changePct)}>
                          {change(q.changePct)}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!filtered.length && (
                    <div className="mp-empty">
                      <Search size={22} />
                      <p>No matching ETF.</p>
                      <button
                        onClick={() => {
                          setQuery("");
                          setGroup("All assets");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                <div className="mp-watch-footer">
                  <span>{filtered.length} / 50 instruments</span>
                  <span>USD · generated</span>
                </div>
              </section>
              <section
                className="mp-chart-panel mp-panel"
                aria-label="Selected asset chart"
              >
                <div className="mp-chart-heading">
                  <div className="mp-asset-title">
                    <span
                      className="mp-asset-emblem"
                      style={{ color: quote.color }}
                    >
                      {quote.symbol.slice(0, 1)}
                    </span>
                    <div>
                      <h2 data-testid="selected-ticker">
                        {symbol}
                        <span>ETF</span>
                      </h2>
                      <p title={quote.name}>{quote.name}</p>
                    </div>
                  </div>
                  <span className="mp-chip">SYNTHETIC</span>
                </div>
                <div className="mp-chart-price">
                  <strong>
                    {price(selectedPoint?.price ?? quote.price)}
                    <span>USD</span>
                  </strong>
                  <span className={positive(inspectedChange)}>
                    {change(inspectedChange)}
                    <small>vs simulated prior close</small>
                  </span>
                  <div className="mp-session-clock">
                    <span
                      className={
                        running ? "mp-status-dot is-running" : "mp-status-dot"
                      }
                    />
                    <b>{frame.timeLabel}</b>
                    <small>SEP 30, 2026 · ET</small>
                  </div>
                </div>
                <div className="mp-chart-toolbar">
                  <span>
                    <Activity size={13} />{" "}
                    {selectedPoint
                      ? `Locked ${time(selectedPoint.timestamp)} ET`
                      : "Price & interval volume"}
                  </span>
                  <div className="mp-chart-buttons">
                    {(["30m", "1h", "all"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRange(r)}
                        aria-pressed={range === r}
                      >
                        {r === "all" ? "Full buffer" : r.toUpperCase()}
                      </button>
                    ))}
                    <button
                      className="mp-icon"
                      aria-label="Toggle area fill"
                      aria-pressed={area}
                      onClick={() => setArea((a) => !a)}
                    >
                      <ChartNoAxesCombined size={14} />
                    </button>
                  </div>
                </div>
                <PulseChart
                  quote={quote}
                  range={range}
                  area={area}
                  onInspect={(i) => {
                    setInspect(
                      i === null ? null : (quote.history[i]?.timestamp ?? null),
                    );
                    setPlaying(false);
                  }}
                />
                <div className="mp-chart-data">
                  <span>
                    Prior close <b>{price(quote.previousClose)}</b>
                  </span>
                  <span>
                    High <b>{price(quote.dayHigh)}</b>
                  </span>
                  <span>
                    Low <b>{price(quote.dayLow)}</b>
                  </span>
                  <span>
                    Volume <b>{count(quote.volume)}</b>
                  </span>
                </div>
                <div className="mp-chart-foot">
                  <span>
                    Generated prices and volume ·{" "}
                    {range === "all"
                      ? "128-point rolling buffer"
                      : `${range} display`}
                  </span>
                  <button
                    onClick={() => setShowTable((t) => !t)}
                    aria-expanded={showTable}
                  >
                    <Table2 size={13} /> Data
                  </button>
                  {inspect && (
                    <button onClick={() => setInspect(null)}>
                      Clear selection <X size={12} />
                    </button>
                  )}
                </div>
              </section>
              <div className="mp-decision-panel mp-panel">{ticket(true)}</div>
            </div>
            <div className="mp-desktop-playback">{replayControls}</div>
            {showTable && (
              <section
                className="mp-session-table mp-panel"
                aria-label="Session data"
              >
                <div className="mp-panel-head">
                  <h2>{symbol} · latest 128 observations</h2>
                  <button
                    className="mp-icon"
                    aria-label="Close data table"
                    onClick={() => setShowTable(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <table>
                    <thead>
                      <tr>
                        <th>Simulated time (ET)</th>
                        <th>Generated price (USD)</th>
                        <th>Generated interval shares</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...quote.history].reverse().map((p) => (
                        <tr key={p.timestamp}>
                          <td>
                            <button
                              className="mp-data-time"
                              onClick={() => {
                                setInspect(p.timestamp);
                                setPlaying(false);
                              }}
                            >
                              {time(p.timestamp)}
                            </button>
                          </td>
                          <td>{price(p.price)}</td>
                          <td>{p.volume.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <div className="mp-bottom-grid">
              <section className="mp-breadth-panel mp-panel">
                <div className="mp-panel-head">
                  <h2>Inside the basket</h2>
                  <span className="mp-eyebrow">50 DEMO INSTRUMENTS</span>
                </div>
                <div className="mp-breadth-body">
                  <div className="mp-breadth-numbers">
                    <div>
                      <ArrowUp size={14} />
                      <strong>{frame.breadth.advancing}</strong>
                      <span>Advancing</span>
                    </div>
                    <div>
                      <ArrowDown size={14} />
                      <strong>{frame.breadth.declining}</strong>
                      <span>Declining</span>
                    </div>
                    <div>
                      <strong>{frame.breadth.unchanged}</strong>
                      <span>Unchanged</span>
                    </div>
                  </div>
                  <div className="mp-breadth-bar">
                    <i style={{ flex: frame.breadth.advancing }} />
                    <i style={{ flex: frame.breadth.declining }} />
                    <i style={{ flex: frame.breadth.unchanged }} />
                  </div>
                  <p>
                    Relative to generated prior closes. This is the demo basket,
                    not exchange-wide market breadth.
                  </p>
                </div>
              </section>
              <section className="mp-group-panel mp-panel">
                <div className="mp-panel-head">
                  <h2>Across asset groups</h2>
                  <span className="mp-eyebrow">EQUAL-WEIGHT DEMO CHANGE</span>
                </div>
                <div className="mp-group-tiles">
                  {frame.groups.map((g) => (
                    <button
                      key={g.sleeve}
                      aria-pressed={group === g.sleeve}
                      className={g.changePct >= 0 ? "positive" : "negative"}
                      onClick={() => {
                        setGroup(group === g.sleeve ? "All assets" : g.sleeve);
                        setQuery("");
                      }}
                    >
                      <span>{g.sleeve}</span>
                      <strong>{change(g.changePct)}</strong>
                      <small>
                        {g.count} ETFs <ArrowUpRight size={12} />
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <div className="mp-disclosure">
              <CircleHelp size={15} />
              <p>
                <strong>A research demo, with a visible boundary.</strong>{" "}
                {REPLAY_META.disclosure} The transition lab uses a separate
                frozen synthetic daily study; the quote animation never changes
                its results. Switch to Market for provider-hosted observed data,
                or run locally to analyze your own prices.
              </p>
            </div>
          </>
        )}
      </main>
      <footer className="mp-footer">
        <span className="mp-footer-brand">
          REBALANCE / REVIEW <i /> Built to question the trade.
        </span>
        <div>
          <a href={`${import.meta.env.BASE_URL}licenses/`}>
            Licenses & sources
          </a>
          <a
            href={`${REPO}#have-an-ai-set-it-up`}
            target="_blank"
            rel="noreferrer"
          >
            AI setup guide <ArrowUpRight size={12} />
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Open source <Code2 size={12} />
          </a>
        </div>
      </footer>
    </div>
  );
}
