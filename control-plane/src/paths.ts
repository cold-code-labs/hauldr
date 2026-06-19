import { fileURLToPath } from "node:url";
import path from "node:path";

// control-plane/src -> repo root
const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");

export const projectMigrationsDir = path.join(repoRoot, "migrations");
export const controlMigrationsDir = path.join(repoRoot, "control");
