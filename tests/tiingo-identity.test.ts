import { describe, expect, it } from 'vitest';
import { parseTiingoDirectory } from '../scripts/update-tiingo-identities.mjs';
import { compatibleTiingoExchange, verifiedTiingoIdentity } from '../src/server/tiingo-identity';
import snapshot from '../src/server/tiingo-identities.json';
import { CATALOG_VERSION, ETF_REGISTRY, getEtf } from '../src/data/registry';

describe('versioned provider identity before price access',()=>{
  it('is bounded, attributable and aligned with this exact ETF directory',()=>{
    expect(snapshot.catalogVersion).toBe(CATALOG_VERSION);expect(snapshot.source.url).toBe('https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip');
    expect(snapshot.source.sha256).toMatch(/^[a-f0-9]{64}$/);expect(snapshot.assets.length).toBeLessThanOrEqual(ETF_REGISTRY.length);
    expect(new Set(snapshot.assets.map(a=>a.symbol)).size).toBe(snapshot.assets.length);expect(snapshot.assets.every(a=>getEtf(a.symbol))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/adjClose|Authorization|api[_-]?key/i);
  });
  it.each(['SPY','BND','QQQ','GLD','USD','CBOA'])('retains available well-identified ETF %s',symbol=>expect(verifiedTiingoIdentity(symbol)).toBe(true));
  it.each([['NYSE Arca','NYSE'],['NYSE Arca','NYSE ARCA'],['NYSE Arca','ARCA'],['Nasdaq','NASDAQ'],['Cboe BZX','BATS'],['NYSE American','AMEX']])('accepts compatible exchange %s / %s',(catalog,provider)=>expect(compatibleTiingoExchange(catalog,provider)).toBe(true));
  it.each([['Nasdaq','SHE'],['NYSE Arca','LSE'],['NYSE Arca','NASDAQ'],['Cboe BZX','PINK'],['F','NYSE'],['Nasdaq','']])('does not guess unresolved identity %s / %s',(catalog,provider)=>expect(compatibleTiingoExchange(catalog,provider)).toBe(false));
  it('does not accept unmatched or cash symbols',()=>{expect(verifiedTiingoIdentity('UNLISTED')).toBe(false);expect(verifiedTiingoIdentity('CASH')).toBe(false);});
  it('marks duplicate conflicting tickers ambiguous instead of choosing by file order',()=>{
    const header='ticker,exchange,assetType,priceCurrency,startDate,endDate\n',first='AAA,NASDAQ,ETF,USD,2020-01-01,2026-10-05',second='AAA,LSE,Stock,GBP,2010-01-01,2026-10-05';
    const expected=[{symbol:'AAA',exchange:'',assetType:'',currency:'',hasHistory:false,ambiguous:true}];
    expect(parseTiingoDirectory(header+first+'\n'+second,['AAA'])).toEqual(expected);expect(parseTiingoDirectory(header+second+'\n'+first,['AAA'])).toEqual(expected);
  });
  it('retains reservations as unavailable and excludes unrelated symbols',()=>{
    const text='ticker,exchange,assetType,priceCurrency,startDate,endDate\nAAA,NASDAQ,ETF,USD,,\nBBB,NASDAQ,ETF,USD,2020-01-01,2026-10-05';
    expect(parseTiingoDirectory(text,['AAA'])).toEqual([{symbol:'AAA',exchange:'NASDAQ',assetType:'ETF',currency:'USD',hasHistory:false,ambiguous:false}]);
    expect(()=>parseTiingoDirectory('ticker,currency\nAAA,USD',['AAA'])).toThrow(/schema changed/);
  });
});
