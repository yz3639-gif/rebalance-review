/** Centered Ledoit–Wolf, maximum-likelihood covariance convention (scikit-learn).
 * Estimate the risky block only: cash must never be shrunk toward its mean diagonal.
 */
export function ledoitWolf(samples: number[][]): number[][] {
  const n = samples.length, p = samples[0]?.length ?? 0;
  if (n < 2 || !p || samples.some(r => r.length !== p || r.some(x => !Number.isFinite(x)))) {
    throw new Error('Covariance needs at least two finite rectangular observations.');
  }
  const mean = Array<number>(p).fill(0);
  for (const r of samples) for (let j = 0; j < p; j++) mean[j] += r[j] / n;
  const covariance = Array.from({ length: p }, () => Array<number>(p).fill(0));
  let fourthMoment = 0;
  for (const r of samples) {
    const x = r.map((v, j) => v - mean[j]);
    const norm2 = x.reduce((sum, v) => sum + v * v, 0);
    fourthMoment += norm2 * norm2;
    for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) covariance[i][j] += x[i] * x[j] / n;
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) covariance[j][i] = covariance[i][j];
  const trace = covariance.reduce((sum, row, i) => sum + row[i], 0), mu = trace / p;
  if (p === 1 || trace === 0) return covariance;
  const norm = covariance.reduce((sum, row) => sum + row.reduce((s, v) => s + v * v, 0), 0);
  const delta = Math.max(0, (norm - 2 * mu * trace + p * mu * mu) / p);
  const beta = Math.min(delta, Math.max(0, (fourthMoment / n - norm) / (p * n)));
  const shrinkage = delta === 0 ? 0 : beta / delta;
  return covariance.map((row, i) => row.map((value, j) => (1 - shrinkage) * value + (i === j ? shrinkage * mu : 0)));
}

export function eulerRisk(weights: number[], covariance: number[][], symbols: string[]) {
  if (weights.length !== symbols.length || covariance.length !== weights.length ||
      covariance.some(r => r.length !== weights.length || r.some(v => !Number.isFinite(v))) ||
      weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Invalid risk dimensions or values.');
  const marginal = covariance.map(row => row.reduce((sum, value, j) => sum + value * weights[j], 0));
  const variance = weights.reduce((sum, weight, i) => sum + weight * marginal[i], 0);
  if (variance < -1e-14) throw new Error('Negative estimated variance.');
  const volatility = Math.sqrt(Math.max(0, variance));
  const contributions = Object.fromEntries(symbols.map((symbol, i) => [symbol, volatility === 0 ? 0 : weights[i] * marginal[i] / volatility]));
  return { volatility, contributions, relativeContributions: volatility === 0 ? null : Object.fromEntries(symbols.map(symbol => [symbol, contributions[symbol] / volatility])) };
}
