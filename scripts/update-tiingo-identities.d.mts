export const TIINGO_DIRECTORY_URL: string;
export function parseTiingoDirectory(text: string, symbols: string[]): Array<{symbol:string;exchange:string;assetType:string;currency:string;hasHistory:boolean;ambiguous:boolean}>;
