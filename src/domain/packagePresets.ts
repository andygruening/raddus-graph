import type { PackagePresetRecord } from "./types";

export function packageEnvSummary(packagePreset: PackagePresetRecord): string {
  const count = packagePreset.environment_variables.length;
  return count > 0 ? `${count} env value${count === 1 ? "" : "s"} required` : "";
}
