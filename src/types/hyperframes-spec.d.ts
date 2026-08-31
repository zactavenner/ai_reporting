// Type surface for the single-source render spec validator shared by the app,
// the hyperframes-jobs edge function and the isolated render worker.
declare module '*/hyperframes-spec.mjs' {
  export function canonicalSpec(value: unknown): string;
  export function validateRenderSpec(spec: unknown, storageUrl: string, clientId: string): number;
}
