import { createProject, listProjects, destroyProject } from "./provision";
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
        "usage: cli <create <name> | destroy <name> | list | zero | master [email]>",
      );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
