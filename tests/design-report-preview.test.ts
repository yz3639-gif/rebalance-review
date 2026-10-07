import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDesignSnapshot } from '../src/design/fixtures';
import { ReportPreview, type ReportPreviewDetails } from '../src/design/ReportPreview';

const standard = buildDesignSnapshot('standard');
const details: ReportPreviewDetails = {
  rationale: 'Rebalance toward bond exposure. 保留自己的复查理由。',
  nextReview: '2025-03-10', archived: true, createdAt: '2025-02-01T12:34:56.000Z',
  versions: { app: 'historic-app', engine: 'historic-engine', method: 'historic-method' },
};
const render = (snapshot = standard, notes?: ReportPreviewDetails) => renderToStaticMarkup(createElement(ReportPreview, { snapshot, details: notes }));

describe('connected report preview', () => {
  it('uses archived user notes, review dates and versions instead of sample metadata', () => {
    const html = render(standard, details);
    expect(html).toContain(details.rationale);
    expect(html).toContain(`Next review · ${details.nextReview}`);
    expect(html).toContain('Created 2025-02-01T12:34:56.000Z');
    expect(html).toContain('App historic-app / Engine historic-engine / Method historic-method');
    expect(html).toContain('SAVED REVIEW');
    expect(html).not.toContain('2026-12-31');
    expect(html).not.toContain('SAMPLE PREVIEW');
  });

  it('describes actual supplied observations without claiming they are generated prices', () => {
    // A display-only provenance test: the fixture is not evidence of supplier integration.
    const supplied = structuredClone(standard);
    supplied.context.manifest.synthetic = false;
    supplied.context.manifest.source = 'User-authorized adjusted prices';
    supplied.result.warnings = [];
    const html = render(supplied, details);
    expect(html).toContain('SUPPLIED MARKET DATA');
    expect(html).toContain('Same supplied observation dates and modeled costs.');
    expect(html).toContain('using the recorded market observations');
    expect(html).not.toContain('SYNTHETIC RESEARCH EXAMPLE');
    expect(html).not.toContain('No observed ETF price data is used.');
    expect(html).not.toContain('These sample price paths are generated mathematics');
  });

  it('preserves all 5,000 reasoning characters across continuation pages', () => {
    const rationale = '中文理由甲乙丙丁戊己'.repeat(500);
    expect(rationale).toHaveLength(5000);
    const html = render(standard, { ...details, rationale });
    const paragraphs = [...html.matchAll(/<p class="dr-report-rationale">([^<]*)<\/p>/g)].map(match => match[1]);
    expect(paragraphs).toHaveLength(5);
    expect(paragraphs.every(paragraph => paragraph.length <= 1000)).toBe(true);
    expect(paragraphs.join('')).toBe(rationale);
    expect(html).toContain('Reasoning · continued');
  });

  it('keeps restricted report pages free of derived results and does not fabricate incomplete notes', () => {
    const html = render(buildDesignSnapshot('restricted'), details);
    expect(html).toContain('DECISION RECORD ONLY');
    expect(html).not.toContain('Historical replay');
    expect(html).not.toContain('Where the risk comes from.');
    expect(html).not.toContain('Ending hypothetical wealth');
    expect(html).toContain(details.rationale);
    const incomplete = render(standard, { ...details, rationale: '' });
    expect(incomplete).toContain('Complete your decision notes');
    expect(incomplete).not.toContain('dr-report-page-content');
    expect(incomplete).not.toContain('Compare a more balanced proposed allocation');
    const withoutDetails = structuredClone(standard);
    withoutDetails.context.manifest.id = 'user-dataset';
    expect(render(withoutDetails)).toContain('Complete your decision notes');
  });

  it('preserves fixture defaults and separates the all-cash assumption from observed data', () => {
    const fixture = render();
    expect(fixture).toContain('SYNTHETIC RESEARCH EXAMPLE');
    expect(fixture).toContain('SAMPLE PREVIEW');
    expect(fixture).toContain('Next review · 2026-12-31');
    const cash = render(buildDesignSnapshot('cash'), details);
    expect(cash).toContain('ZERO-RETURN CASH ASSUMPTION');
    expect(cash).toContain('Same modeled cash dates and 0% return assumption.');
    expect(cash).not.toContain('SUPPLIED MARKET DATA');
    expect(cash).not.toContain('SYNTHETIC RESEARCH EXAMPLE');
  });
});
