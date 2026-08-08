const APPS_ROOT = ".apps";

export function appPath(...segments: string[]): string {
  return [APPS_ROOT, ...segments].join("/");
}
