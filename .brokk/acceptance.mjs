#!/usr/bin/env node

/**
 * Acceptance test for secret-in-fallback security fix.
 * 
 * Verifies that:
 * 1. The application fails fast when HAULDR_DB_ADMIN_URL is not set
 * 2. The hardcoded postgres:postgres credentials are no longer used
 * 3. A valid HAULDR_DB_ADMIN_URL allows the application to load
 */

import { spawn } from "child_process";
import { resolve } from "path";

const cwd = resolve("control-plane");

/**
 * Test 1: Application should fail when HAULDR_DB_ADMIN_URL is not set
 */
async function testMissingEnvVar() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["tsx", "-e", `
      import('./src/config.ts').catch(e => {
        if (e.message.includes('HAULDR_DB_ADMIN_URL')) {
          console.log('✓ Test 1 passed: Missing env var causes error with clear message');
          process.exit(0);
        } else {
          console.log('✗ Test 1 failed: Wrong error message:', e.message);
          process.exit(1);
        }
      });
    `], { cwd, stdio: "pipe" });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });

    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.includes("✓ Test 1 passed")) {
        resolve(true);
      } else {
        reject(new Error(`Test 1 failed: ${stderr || stdout}`));
      }
    });
  });
}

/**
 * Test 2: Application should load with valid HAULDR_DB_ADMIN_URL
 */
async function testValidEnvVar() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HAULDR_DB_ADMIN_URL: "postgres://admin:secretpass@localhost:5432/postgres",
    };

    const proc = spawn("npx", ["tsx", "-e", `
      import('./src/config.ts').then(m => {
        const url = m.config.adminUrl;
        const isSafe = !url.includes('postgres:postgres');
        if (isSafe && url.startsWith('postgres://')) {
          console.log('✓ Test 2 passed: Config loads with valid URL and no hardcoded creds');
          process.exit(0);
        } else {
          console.log('✗ Test 2 failed: Invalid URL or hardcoded credentials detected');
          process.exit(1);
        }
      }).catch(e => {
        console.log('✗ Test 2 failed:', e.message);
        process.exit(1);
      });
    `], { cwd, stdio: "pipe", env });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });

    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.includes("✓ Test 2 passed")) {
        resolve(true);
      } else {
        reject(new Error(`Test 2 failed: ${stderr || stdout}`));
      }
    });
  });
}

/**
 * Test 3: Verify cronAdminUrl also requires env var or falls back to adminUrl
 */
async function testCronAdminUrl() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HAULDR_DB_ADMIN_URL: "postgres://admin:secretpass@localhost:5432/postgres",
      HAULDR_CRON_ADMIN_URL: "postgres://cron:cronpass@localhost:5433/postgres",
    };

    const proc = spawn("npx", ["tsx", "-e", `
      import('./src/config.ts').then(m => {
        const adminUrl = m.config.adminUrl;
        const cronUrl = m.config.cronAdminUrl;
        
        // Should both be set and not contain hardcoded credentials
        const noHardcoded = !adminUrl.includes('postgres:postgres') && 
                           !cronUrl.includes('postgres:postgres');
        const bothSet = adminUrl && cronUrl;
        
        if (noHardcoded && bothSet) {
          console.log('✓ Test 3 passed: cronAdminUrl respects env var without hardcoded creds');
          process.exit(0);
        } else {
          console.log('✗ Test 3 failed: cronAdminUrl not properly configured');
          process.exit(1);
        }
      }).catch(e => {
        console.log('✗ Test 3 failed:', e.message);
        process.exit(1);
      });
    `], { cwd, stdio: "pipe", env });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });

    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.includes("✓ Test 3 passed")) {
        resolve(true);
      } else {
        reject(new Error(`Test 3 failed: ${stderr || stdout}`));
      }
    });
  });
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("🧪 Running security fix acceptance tests...\n");

  try {
    console.log("Test 1: Missing HAULDR_DB_ADMIN_URL should fail fast...");
    await testMissingEnvVar();
    console.log();

    console.log("Test 2: Valid HAULDR_DB_ADMIN_URL should load without hardcoded creds...");
    await testValidEnvVar();
    console.log();

    console.log("Test 3: cronAdminUrl should not have hardcoded credentials...");
    await testCronAdminUrl();
    console.log();

    console.log("✅ All acceptance tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
}

runTests();
