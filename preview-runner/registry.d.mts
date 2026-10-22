export type RuntimePackage = { spec: string; file: string; kind: "cjs" | "esm"; defaultExport?: boolean; aliasOf?: string };
export declare const RUNTIME_PACKAGES: Record<string, RuntimePackage>;
export declare const THREE_ADDONS: string[];
export declare const RUNTIME_VERSION: string;
export declare function isAllowedSpecifier(spec: string): boolean;
export declare function packageName(spec: string): string;
export declare function importMap(base: string): { imports: Record<string, string> };
export declare function allowedSpecifierList(): string[];
