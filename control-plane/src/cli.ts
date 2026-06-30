import { createProject, listProjects, destroyProject } from "./provision";
import { provisionRest, destroyRest } from "./postgrest";
import { provisionStorageApi, destroyStorageApi } from "./storageapi";
import { provisionFunctions, destroyFunctions } from "./functionsapi";
import { preflightSource, formatPreflight } from "./preflight";
import { migrateIn } from "./migrate-in";
import { reconcileProject, reconcileAll } from "./reconcile";
import { ensureProjectZero, ensureMaster } from "./zero";
import { config } from "./config";

const [cmd, arg] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "create": {
      if (!arg) throw new Error("usage: cli create <name>");
      const res = await createProject(arg);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "destroy": {
      if (!arg) throw new Error("usage: cli destroy <name>");
      const res = await destroyProject(arg);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "list":
      console.log(JSON.stringify(await listProjects(), null, 2));
      break;
    case "rest": {
      // Turn on the à-la-carte REST (PostgREST) layer for a project.
      if (!arg) throw new Error("usage: cli rest <name>");
      const res = await provisionRest(arg);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "unrest": {
      if (!arg) throw new Error("usage: cli unrest <name>");
      await destroyRest(arg);
      console.log(`rest removed for ${arg}`);
      break;
    }
    case "storage": {
      // Turn on the à-la-carte Storage (supabase/storage-api) layer for a project.
      if (!arg) throw new Error("usage: cli storage <name>");
      const res = await provisionStorageApi(arg);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "unstorage": {
      if (!arg) throw new Error("usage: cli unstorage <name>");
      await destroyStorageApi(arg);
      console.log(`storage removed for ${arg}`);
      break;
    }
    case "functions": {
      // Turn on the à-la-carte Functions Plane (supabase/edge-runtime) for a
      // project. Source must live at `${HAULDR_FUNCTIONS_DIR}/<name>` (main/ +
      // one dir per function) — populated by migrate-in.
      if (!arg) throw new Error("usage: cli functions <name>");
      const res = await provisionFunctions(arg);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "unfunctions": {
      if (!arg) throw new Error("usage: cli unfunctions <name>");
      await destroyFunctions(arg);
      console.log(`functions removed for ${arg}`);
      break;
    }
    case "preflight": {
      // Read-only go/no-go inventory of a source Supabase project (PAT from
      // HAULDR_MIGRATE_PAT). usage: cli preflight <ref>
      if (!arg) throw new Error("usage: cli preflight <supabase-ref>");
      console.log(formatPreflight(await preflightSource(arg)));
      break;
    }
    case "migrate-in": {
      // Import a Supabase project: preflight + provision, then emit the guided
      // data gates. usage: cli migrate-in <name> --from <supabase-ref>
      const argv = process.argv.slice(2);
      const fromIdx = argv.indexOf("--from");
      const ref = fromIdx >= 0 ? argv[fromIdx + 1] : undefined;
      if (!arg || !ref) throw new Error("usage: cli migrate-in <name> --from <supabase-ref>");
      const res = await migrateIn({ name: arg, ref });
      console.log(formatPreflight(res.preflight));
      console.log(`\nprovisioned ${res.name} → ${res.baseUrl} (auth+rest${res.provisioned.storage ? "+storage" : ""})`);
      console.log(`\nremaining gates (operator-run):\n${res.nextGates.join("\n")}`);
      break;
    }
    case "reconcile": {
      // Heal routing drift: re-apply the current shape (namespace + `/v1` alias)
      // to a project's existing sidecars. `reconcile` / `reconcile all` = fleet.
      const res = arg && arg !== "all" ? await reconcileProject(arg) : await reconcileAll();
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "zero": {
      // Prepare project zero's database (idempotent).
      await ensureProjectZero();
      console.log(`project zero db ready: ${config.zeroDb}`);
      console.log("→ bring up GoTrue (docker compose up -d auth), then: cli master");
      break;
    }
    case "master": {
      // Create/confirm the master operator (requires GoTrue to be running).
      const email = arg || config.masterEmail;
      const r = await ensureMaster(email, config.masterPassword);
      console.log(`master ${email}: ${r.created ? "created" : "already existed"}`);
      break;
    }
    default:
      console.log(
        "usage: cli <create <name> | destroy <name> | rest <name> | unrest <name> | storage <name> | unstorage <name> | functions <name> | unfunctions <name> | preflight <ref> | migrate-in <name> --from <ref> | reconcile [name|all] | list | zero | master [email]>",
      );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
