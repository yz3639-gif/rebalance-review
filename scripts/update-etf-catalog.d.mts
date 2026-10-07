export interface DirectoryAsset { symbol: string; name: string; exchange: string; source: number }
export function parseDirectory(text: string, source: number): { assets: DirectoryAsset[]; fileCreatedAt: string };
export function compareCatalog(previous: { assets: { symbol: string; name: string }[] }, next: { assets: { symbol: string; name: string }[] }): { added: string[]; removed: string[]; changed: string[] };
