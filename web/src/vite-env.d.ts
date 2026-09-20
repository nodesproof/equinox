/// <reference types="vite/client" />
declare const __COMMIT__: string;
declare const __BUILD_TIME__: string;
// `@deployment` diketik dari JSON-nya sendiri lewat tsconfig `paths` + `resolveJsonModule` (tanpa deklarasi ambient).
interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?(ev: string, cb: (...a: unknown[]) => void): void } }
