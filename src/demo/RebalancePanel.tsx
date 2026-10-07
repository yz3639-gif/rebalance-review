import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
} from "lucide-react";
import { computeActiveRisk, computeTransition } from "../engine/transition";
import { freezeSnapshot } from "../design/model";
import type { DesignSnapshot } from "../design/types";
import { AllocationEditor } from "./AllocationEditor";
import {
  applyAllocationPreset,
  validateAllocationDraft,
  type AllocationDraftRow,
} from "./allocationDraft";

const dollar = (v: number, digits = 0) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const percent = (v: number) => `${(v * 100).toFixed(2)}%`;
const PRESETS = [
  { id: "core", name: "Core rotation" },
  { id: "defensive", name: "Defensive shift" },
  { id: "unchanged", name: "Keep allocation" },
] as const;

export function usePulseStudy() {
  const [snapshot, setSnapshot] = useState<DesignSnapshot | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../design/design.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      setError(
        "The research worker could not start. Dollar trade sizing is still available.",
      );
      return;
    }
    const timer = setTimeout(() => {
      if (active)
        setError("The research calculation timed out. Retry the study.");
      worker.terminate();
    }, 120000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      if (active) {
        if (event.data.ok) {
          setSnapshot(freezeSnapshot(event.data.snapshot));
          setError("");
        } else setError("The sample study could not be calculated.");
      }
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timer);
      if (active) setError("The research worker could not load.");
      worker.terminate();
    };
    try {
      worker.postMessage({ id: "standard" });
    } catch {
      clearTimeout(timer);
      worker.terminate();
      setError(
        "The research worker could not start. Dollar trade sizing is still available.",
      );
    }
    return () => {
      active = false;
      clearTimeout(timer);
      worker.terminate();
    };
  }, [attempt]);
  return {
    snapshot,
    error,
    retry: () => {
      setError("");
      setAttempt((v) => v + 1);
    },
  };
}

export interface TransitionControls {
  presetId: string;
  bps: number;
  nav: number;
  riskWindow: number;
  allocations: AllocationDraftRow[];
}
export function RebalancePanel({
  snapshot,
  compact = false,
  controls,
  onControls,
  onExpand,
  onResearch,
  studyError,
  onRetryStudy,
}: {
  snapshot: DesignSnapshot | null;
  compact?: boolean;
  controls: TransitionControls;
  onControls: (state: TransitionControls) => void;
  onExpand?: () => void;
  onResearch?: () => void;
  studyError?: string;
  onRetryStudy?: () => void;
}) {
  const { presetId, bps, nav, riskWindow, allocations } = controls;
  const setPreset = (presetId: string) => {
    if (presetId === "custom") return;
    onControls({
      ...controls,
      presetId,
      allocations: applyAllocationPreset(
        allocations,
        presetId as "core" | "defensive" | "unchanged",
      ),
    });
  };
  const setBps = (bps: number) => onControls({ ...controls, bps });
  const setNav = (nav: number) => onControls({ ...controls, nav });
  const setWindow = (riskWindow: number) =>
    onControls({ ...controls, riskWindow });
  const draft = useMemo(
    () => validateAllocationDraft(allocations),
    [allocations],
  );
  const { symbols, weightsA: a, weightsB: b } = draft;
  const calculation = useMemo(() => {
    if (!draft.valid) return { ticket: null, error: "" };
    try {
      return {
        ticket: computeTransition({
          symbols,
          currentValues: a.map((w) => w * nav),
          targetWeights: b,
          costBps: bps,
        }),
        error: "",
      };
    } catch {
      return {
        ticket: null,
        error:
          "This allocation could not be reconciled. Adjust the weights or reset the example to retry.",
      };
    }
  }, [draft.valid, symbols, a, b, nav, bps]);
  const { ticket } = calculation;
  const covariance = snapshot?.result.risk.windows.find(
    (w) => w.window === riskWindow,
  )?.covariance;
  const missingRisk = snapshot
    ? symbols.filter(
        (s) => s !== "CASH" && !snapshot.result.symbols.includes(s),
      )
    : [];
  const riskCalculation = useMemo(() => {
    if (
      !draft.valid ||
      missingRisk.length ||
      (!covariance && symbols.some((s) => s !== "CASH"))
    )
      return { result: null, error: "" };
    // Draft row order is independent of the frozen study's covariance order.
    const mapped = symbols.map((left) =>
      symbols.map((right) =>
        left === "CASH" || right === "CASH"
          ? 0
          : covariance![snapshot!.result.symbols.indexOf(left)][
              snapshot!.result.symbols.indexOf(right)
            ],
      ),
    );
    try {
      return {
        result: computeActiveRisk({
          symbols,
          weightsA: a,
          weightsB: b,
          covariance: mapped,
        }),
        error: "",
      };
    } catch {
      return {
        result: null,
        error:
          "The covariance validation failed. Dollar trades and fees are still available.",
      };
    }
  }, [draft, symbols, a, b, covariance, snapshot, missingRisk.length]);
  const activeRisk = riskCalculation.result;
  return (
    <section
      className={`mp-rebalance ${compact ? "mp-rebalance-compact" : ""}`}
      aria-label={compact ? "Rebalance summary" : "Rebalance workbench"}
    >
      <div className="mp-section-head">
        <span className="mp-eyebrow">
          {compact ? "02 / DECISION LAB" : "A → B / TRANSITION ANALYSIS"}
        </span>
        <span className="mp-chip">
          {presetId === "custom" ? "CUSTOM" : "EXAMPLE"}
        </span>
      </div>
      <h2>
        {compact
          ? "Make your next move."
          : "What does the switch actually cost?"}
      </h2>
      <p className="mp-muted">
        {compact
          ? "Edit A → B. See the trade-offs instantly."
          : "Edit current and target weights directly. A self-financing transition sizes the trades and costs against your after-fee target."}
      </p>
      <div className="mp-ticket-controls">
        <label>
          Allocation change
          <select
            aria-label="Target allocation"
            value={presetId}
            onChange={(e) => setPreset(e.target.value)}
          >
            {presetId === "custom" && (
              <option value="custom">Custom allocation</option>
            )}
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!compact && (
          <>
            <label>
              Account value
              <select
                aria-label="Account value"
                value={nav}
                onChange={(e) => setNav(Number(e.target.value))}
              >
                {[25000, 100000, 250000, 1000000].map((v) => (
                  <option key={v} value={v}>
                    {dollar(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cost assumption
              <select
                aria-label="Transition cost"
                value={bps}
                onChange={(e) => setBps(Number(e.target.value))}
              >
                {[0, 2, 5, 10, 20].map((v) => (
                  <option key={v} value={v}>
                    {v} bps per traded dollar
                  </option>
                ))}
              </select>
            </label>
            <label>
              Risk lookback
              <select
                aria-label="Active risk window"
                value={riskWindow}
                onChange={(e) => setWindow(Number(e.target.value))}
              >
                {[126, 252, 504].map((v) => (
                  <option key={v} value={v}>
                    {v} sessions
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <AllocationEditor
        rows={allocations}
        onChange={(allocations) =>
          onControls({ ...controls, presetId: "custom", allocations })
        }
        onReset={(allocations) =>
          onControls({ ...controls, presetId: "core", allocations })
        }
      />
      {!ticket && (
        <div className="mp-allocation-invalid" role="status">
          <strong>
            {calculation.error
              ? "Review the allocation"
              : "Complete both allocations"}
          </strong>
          <p>
            {calculation.error ||
              draft.errors[0]?.message ||
              "A and B must each total 100%."}{" "}
            Results update when both are valid.
          </p>
        </div>
      )}
      {ticket && (
        <>
          <div className="mp-trade-metrics">
            <div>
              <span>Gross traded</span>
              <strong data-testid="transition-gross">
                {dollar(ticket.grossTraded)}
              </strong>
              <small>{percent(ticket.grossTurnover)} of starting value</small>
            </div>
            <div>
              <span>One-time cost</span>
              <strong data-testid="transition-fee">
                {dollar(ticket.fees, 2)}
              </strong>
              <small>{bps} bps × (buys + sells)</small>
            </div>
            <div className="mp-active-risk">
              <span>
                Active risk <CircleHelp size={12} />
              </span>
              <strong data-testid="active-risk">
                {activeRisk ? percent(activeRisk.trackingError) : "N/A"}
              </strong>
              <small>Annualized tracking error · B − A</small>
            </div>
          </div>
          {!activeRisk && (
            <div className="mp-risk-unavailable" role="status">
              <strong>
                {!snapshot && !studyError
                  ? "Risk study loading."
                  : "Risk unavailable."}
              </strong>{" "}
              {riskCalculation.error ||
                studyError ||
                (missingRisk.length
                  ? `No historical covariance for ${missingRisk.join(", ")}. Import these assets in the local app to calculate risk from your own data.`
                  : "Dollar trades and fees do not need the sample covariance.")}
              {studyError && (
                <button className="mp-secondary" onClick={onRetryStudy}>
                  Retry study
                </button>
              )}
            </div>
          )}
        </>
      )}
      {compact ? (
        <>
          <p className="mp-method-note">
            {dollar(nav)} example · {riskWindow}-session synthetic covariance.
            Edits update this transition only. Quotes and the original research
            study stay separate.
          </p>
          <button className="mp-primary mp-full" onClick={onExpand}>
            Inspect the transition <ChevronRight size={15} />
          </button>
        </>
      ) : ticket ? (
        <>
          <div className="mp-ticket-body">
            <div className="mp-trade-table-wrap">
              <table className="mp-trade-table">
                <caption>One-time trade amounts · USD</caption>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Current A</th>
                    <th>Target B</th>
                    <th>Trade amount</th>
                    <th>After trade</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.rows.map((r) => (
                    <tr key={r.symbol}>
                      <th>{r.symbol}</th>
                      <td>{(r.currentWeight * 100).toFixed(1)}%</td>
                      <td>{(r.targetWeight * 100).toFixed(1)}%</td>
                      <td
                        className={
                          r.symbol === "CASH"
                            ? ""
                            : r.deltaAmount >= 0
                              ? "mp-positive"
                              : "mp-negative"
                        }
                      >
                        {r.symbol === "CASH"
                          ? r.deltaAmount < 0
                            ? "Cash − "
                            : "Cash + "
                          : Math.abs(r.deltaAmount) < 0.005
                            ? "Hold "
                            : r.deltaAmount > 0
                              ? "Buy "
                              : "Sell "}
                        {dollar(Math.abs(r.deltaAmount), 2)}
                      </td>
                      <td>{dollar(r.targetAmount, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mp-risk-breakdown">
              <h3>Where the active risk comes from</h3>
              <p>
                {!activeRisk ? (
                  "Risk contributions are unavailable for this allocation. Dollar trade sizing remains available."
                ) : (
                  <>
                    Signed contributions to annualized tracking error. Negative
                    contributions can offset risk.
                  </>
                )}
              </p>
              {activeRisk &&
                symbols.map((s) => {
                  const v = activeRisk?.contributions[s] ?? 0;
                  const max = Math.max(
                    ...Object.values(activeRisk?.contributions ?? {}).map(
                      Math.abs,
                    ),
                    0.000001,
                  );
                  return (
                    <div className="mp-risk-row" key={s}>
                      <b>{s}</b>
                      <div>
                        <i
                          style={{
                            width: `${(Math.abs(v) / max) * 50}%`,
                            left:
                              v < 0
                                ? `${50 - (Math.abs(v) / max) * 50}%`
                                : "50%",
                            background: v < 0 ? "#9db7f5" : "#65d6b5",
                          }}
                        />
                      </div>
                      <span>
                        {v < 0 ? "−" : "+"}
                        {(Math.abs(v) * 100).toFixed(3)} pp
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="mp-reconciliation">
            <span>
              <ArrowDownRight size={15} /> Sells{" "}
              {dollar(ticket.sellNotional, 2)}
            </span>
            <span>
              <ArrowUpRight size={15} /> Buys {dollar(ticket.buyNotional, 2)}
            </span>
            <span>
              <Check size={15} /> After-fee value {dollar(ticket.afterNav, 2)}
            </span>
            <span>Cash after {dollar(ticket.cashAfter, 2)}</span>
          </div>
          <details className="mp-assumptions">
            <summary>Calculation assumptions & source</summary>
            <p>
              Current dollar values are A weights × the selected account value;
              trade sizing does not need a quote price. Fractional dollar
              trades, a flat cost on noncash buys and sells, no taxes, bid/ask
              model, market impact or order submission. Target weights apply to
              after-fee account value. Gross turnover is (buys + sells) /
              before-trade NAV; it is not half-turnover. Amounts are calculated
              at full precision and rounded here.
            </p>
            <p>
              Active risk = √((wB − wA)ᵀΣ(wB − wA)), with annualized Ledoit–Wolf
              covariance from the same fixed {riskWindow}-session synthetic
              window{" "}
              {snapshot
                ? `ending ${snapshot.result.end}`
                : "(study unavailable)"}
              . Cash has zero variance. This is a risk estimate, not a forecast
              of excess return, a confidence interval for CAGR or a
              recommendation. The reference universe covers SPY, VXUS, BND, GLD
              and IEF, plus zero-variance cash. Other funded assets make active
              risk unavailable; their dollar transitions still calculate. The
              historical research workspace retains its own original A/B
              allocations.
            </p>
          </details>
          <button className="mp-secondary" onClick={onResearch}>
            Explore the original historical A/B study <ArrowRight size={15} />
          </button>
        </>
      ) : null}
    </section>
  );
}
