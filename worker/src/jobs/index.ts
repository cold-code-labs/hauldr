import type { FleetJob } from "./types";
import { brokkAccess } from "./brokk-access";
import { kapsoUsage } from "./kapso-usage";
import { appCallback } from "./app-callback";

/**
 * The fleet job registry. Add a job: create a file in this folder exporting a
 * `FleetJob`, then add it here. The worker entrypoint registers everything.
 */
export const jobs: FleetJob[] = [brokkAccess, kapsoUsage, appCallback];
