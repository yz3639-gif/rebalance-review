import { useId, useRef, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import catalog from "./market-catalog.json";
import {
  balanceAllocationWithCash,
  createDefaultAllocationDraft,
  normalizePercentageDraft,
  type AllocationDraftRow,
  validateAllocationDraft,
} from "./allocationDraft";

const assets = [...catalog.assets, { symbol: "CASH", name: "US dollar cash" }];
const totalText = (value: number | null) =>
  value === null ? "Incomplete" : `${Number(value.toFixed(6))}%`;

export function AllocationEditor({
  rows,
  onChange,
  onReset,
}: {
  rows: AllocationDraftRow[];
  onChange: (rows: AllocationDraftRow[]) => void;
  onReset: (rows: AllocationDraftRow[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const validation = validateAllocationDraft(rows);
  const complete = (side: "a" | "b") =>
    validation.totals[side] !== null &&
    !validation.errors.some(
      (error) =>
        error.field === side ||
        error.field === (side === "a" ? "totalA" : "totalB"),
    );
  const available = assets.filter(
    (asset) => !rows.some((row) => row.symbol === asset.symbol),
  );
  const matches = available.filter((asset) =>
    `${asset.symbol} ${asset.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const exact = available.find(
    (asset) => asset.symbol === query.trim().toUpperCase(),
  );
  const candidate =
    exact ?? (matches.length === 1 && query.trim() ? matches[0] : undefined);
  const update = (symbol: string, side: "a" | "b", value: string) => {
    setNotice("");
    onChange(
      rows.map((row) =>
        row.symbol === symbol ? { ...row, [side]: value } : row,
      ),
    );
  };
  const add = (symbol: string) => {
    onChange([...rows, { symbol, a: "0", b: "0" }]);
    setQuery("");
    setNotice(`${symbol} added. Enter a weight in A or B.`);
    input.current?.focus();
  };
  const balance = (side: "a" | "b") => {
    const result = balanceAllocationWithCash(rows, side);
    setNotice(
      result.error ??
        `${side.toUpperCase()} cash set to the remaining allocation.`,
    );
    if (!result.error) onChange(result.rows);
  };
  return (
    <section
      className="mp-allocation-editor"
      aria-label="Edit portfolio weights"
    >
      <div className="mp-editor-title">
        <span>
          EDIT ALLOCATION <small>Weight %</small>
        </span>
        <button
          type="button"
          aria-label="Reset example allocations"
          title="Reset A and B to the example"
          onClick={() => {
            onReset(createDefaultAllocationDraft());
            setQuery("");
            setNotice("Example allocations restored.");
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div
        className={`mp-weight-scroll ${rows.length <= 6 ? "mp-weights-short" : ""}`}
        tabIndex={0}
        role="region"
        aria-label="Allocation weights"
      >
        <table className="mp-weight-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>
                A <small>Current</small>
              </th>
              <th>
                B <small>Target</small>
              </th>
              <th>
                <span className="mp-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <th
                  scope="row"
                  title={
                    assets.find((asset) => asset.symbol === row.symbol)?.name
                  }
                >
                  {row.symbol}
                </th>
                {(["a", "b"] as const).map((side) => (
                  <td key={side}>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`${side.toUpperCase()} weight ${row.symbol}`}
                      aria-invalid={validation.errors.some(
                        (error) =>
                          error.rowIndex === rows.indexOf(row) &&
                          error.field === side,
                      )}
                      value={row[side]}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) =>
                        update(row.symbol, side, event.target.value)
                      }
                      onBlur={(event) => {
                        const normalized = normalizePercentageDraft(
                          event.target.value,
                        );
                        if (normalized !== row[side])
                          update(row.symbol, side, normalized);
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    aria-label={`Remove ${row.symbol}`}
                    title={`Remove ${row.symbol} from A and B`}
                    onClick={() => {
                      onChange(
                        rows.filter((item) => item.symbol !== row.symbol),
                      );
                      setNotice(`${row.symbol} removed from A and B.`);
                    }}
                  >
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="mp-weight-totals"
        role="group"
        aria-label="Allocation totals"
      >
        <span className={complete("a") ? "is-complete" : "is-incomplete"}>
          A <b>{totalText(validation.totals.a)}</b>
        </span>
        <span className={complete("b") ? "is-complete" : "is-incomplete"}>
          B <b>{totalText(validation.totals.b)}</b>
        </span>
      </div>
      <div className="mp-cash-actions">
        <button
          type="button"
          aria-label="Balance A with cash"
          onClick={() => balance("a")}
        >
          A: fill with cash
        </button>
        <button
          type="button"
          aria-label="Balance B with cash"
          onClick={() => balance("b")}
        >
          B: fill with cash
        </button>
      </div>
      <div className="mp-add-asset">
        <input
          ref={input}
          type="search"
          aria-label="Add ETF or cash"
          placeholder="Add ticker or search name"
          value={query}
          aria-controls={`${id}-matches`}
          onChange={(event) => {
            setQuery(event.target.value);
            setNotice("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && candidate) {
              event.preventDefault();
              add(candidate.symbol);
            }
            if (event.key === "Escape") setQuery("");
          }}
        />
        <button
          type="button"
          aria-label="Add holding"
          title="Add holding"
          disabled={!candidate}
          onClick={() => candidate && add(candidate.symbol)}
        >
          <Plus size={16} />
        </button>
      </div>
      {query.trim() && (
        <div
          id={`${id}-matches`}
          className="mp-add-results"
          role="region"
          aria-label="Matching holdings"
        >
          {matches.slice(0, 6).map((asset) => (
            <button
              type="button"
              key={asset.symbol}
              onClick={() => add(asset.symbol)}
            >
              <b>{asset.symbol}</b>
              <span>{asset.name}</span>
            </button>
          ))}
          {!matches.length && (
            <p>
              {rows.some((row) => row.symbol === query.trim().toUpperCase())
                ? "Already in your allocations."
                : "No match in the 50-ETF demo directory. The local app has the full US ETF directory."}
            </p>
          )}
          {matches.length > 6 && (
            <p>Keep typing to narrow {matches.length} matches.</p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="mp-editor-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
