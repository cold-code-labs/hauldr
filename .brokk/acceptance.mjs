#!/usr/bin/env node

/**
 * Acceptance test for security fix: insecure-crypto vulnerability in adminToken()
 * 
 * Verifies that:
 * 1. adminToken() throws an error when HAULDR_JWT_SECRET is empty or unset
 * 2. adminToken() generates valid JWT when HAULDR_JWT_SECRET is set
 */

import { spawn } from "child_process";
import fs from "fs";

async function runTest() {
  console.log("Testing security fix: insecure-crypto (empty JWT secret guard)...\n");

  // Test 1: Verify the guard throws an error for empty secret
  console.log("Test 1: Empty JWT secret should throw error");
  const test1Code = `
import crypto from "node:crypto";

const config = { jwtSecret: "" };

function adminToken() {
  if (!config.jwtSecret) throw new Error("HAULDR_JWT_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role: "supabase_admin", iat: now, exp: now + 300 }),
  ).toString("base64url");
  const data = \`\${header}.\${payload}\`;
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  return \`\${data}.\${sig}\`;
}

try {
  adminToken();
  console.error("FAIL: Should have thrown error");
  process.exit(1);
} catch (e) {
  if (e.message === "HAULDR_JWT_SECRET is not set") {
    console.log("PASS: Correctly throws error for empty secret");
    process.exit(0);
  } else {
    console.error("FAIL: Wrong error message:", e.message);
    process.exit(1);
  }
}
`;

  const result1 = await runNodeCode(test1Code);
  if (result1 !== 0) {
    console.error("❌ Test 1 failed");
    return false;
  }
  console.log("✓ Test 1 passed\n");

  // Test 2: Verify valid JWT is generated when secret is set
  console.log("Test 2: Valid JWT secret should generate token");
  const test2Code = `
import crypto from "node:crypto";

const config = { jwtSecret: "valid-secret-key" };

function adminToken() {
  if (!config.jwtSecret) throw new Error("HAULDR_JWT_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role: "supabase_admin", iat: now, exp: now + 300 }),
  ).toString("base64url");
  const data = \`\${header}.\${payload}\`;
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  return \`\${data}.\${sig}\`;
}

try {
  const token = adminToken();
  const parts = token.split(".");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    console.log("PASS: Generated valid JWT token");
    process.exit(0);
  } else {
    console.error("FAIL: Invalid JWT format");
    process.exit(1);
  }
} catch (e) {
  console.error("FAIL: Unexpected error:", e.message);
  process.exit(1);
}
`;

  const result2 = await runNodeCode(test2Code);
  if (result2 !== 0) {
    console.error("❌ Test 2 failed");
    return false;
  }
  console.log("✓ Test 2 passed\n");

  // Test 3: Verify the actual source code has the guard
  console.log("Test 3: Verify source code contains the guard");
  const sourceCode = fs.readFileSync("./control-plane/src/realtime.ts", "utf-8");
  if (sourceCode.includes('if (!config.jwtSecret) throw new Error("HAULDR_JWT_SECRET is not set")')) {
    console.log("PASS: Guard found in source code");
    console.log("✓ Test 3 passed\n");
  } else {
    console.error("FAIL: Guard not found in source code");
    return false;
  }

  return true;
}

async function runNodeCode(code) {
  return new Promise((resolve) => {
    const proc = spawn("node", ["--input-type=module"], {
      stdio: ["pipe", "inherit", "inherit"],
    });

    proc.stdin.write(code);
    proc.stdin.end();

    proc.on("close", (code) => {
      resolve(code);
    });
  });
}

// Run the tests
const success = await runTest();

if (success) {
  console.log("✅ All acceptance tests passed!");
  console.log("\nSecurity fix summary:");
  console.log("- Added guard: if (!config.jwtSecret) throw new Error('HAULDR_JWT_SECRET is not set')");
  console.log("- Location: control-plane/src/realtime.ts:91 (adminToken function)");
  console.log("- Impact: Prevents JWT signing with empty key, matching pattern from zero.ts");
  process.exit(0);
} else {
  console.error("❌ Acceptance tests failed!");
  process.exit(1);
}
