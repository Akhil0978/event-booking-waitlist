import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const root = resolve(process.argv[2] || fileURLToPath(new URL("../", import.meta.url)));
const dependencyRoot = resolve(process.argv[3] || root);
const require = createRequire(join(dependencyRoot, "server/package.json"));
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { configureHosting } = await import(pathToFileURL(join(root, "server/hosting.js")));
const authSource = readFileSync(join(root, "server/auth.js"), "utf8")
  .replace(/^import .+;\n/gm, "").replace(/^export /gm, "");
const serverSource = readFileSync(join(root, "server/index.js"), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "").replace(/\nstartServer\(\);\s*$/, "\n");
const fixture = mkdtempSync(join(tmpdir(), "event-booking-hosting-check-"));
mkdirSync(join(fixture, "assets"));
writeFileSync(join(fixture, "index.html"), "<!doctype html><h1>Hosting check</h1>");
writeFileSync(join(fixture, "assets/app.js"), "window.hostingCheck = true;");
writeFileSync(join(fixture, ".env"), "DO_NOT_SERVE_THIS_FILE");

// Only the database and session store are doubles. Express, session cookies,
// bcrypt, rate limiting, the auth handlers and server route order are real.
function loadAuth(settings) {
  for (const name of ["NODE_ENV", "APP_ORIGINS", "RENDER", "RENDER_EXTERNAL_URL"]) {
    delete process.env[name];
  }
  Object.assign(process.env, settings);
  process.env.SESSION_SECRET = "test-only-secret-not-used-by-the-application";
  const users = new Map();
  let lookups = 0;
  const User = {
    async init() {},
    async create(data) {
      const user = { ...data, _id: String(users.size + 1).padStart(24, "0") };
      users.set(user._id, user);
      return user;
    },
    async findById(id) { lookups++; return users.get(String(id)) || null; },
    findOne({ email }) {
      return { select: async () => [...users.values()].find(user => user.email === email) || null };
    },
  };
  const store = new session.MemoryStore();
  const auth = new Function("express", "session", "MongoStore", "bcrypt", "rateLimit", "randomBytes", "User",
    authSource + "\nreturn {createAuthSession, loadCurrentUser, requireLogin, requireAdmin, requireTrustedRequest, authRouter};"
  )(express, session, { create: () => store }, bcrypt, rateLimit, randomBytes, User);
  return { ...auth, lookups: () => lookups };
}

async function serve(settings, callback) {
  const auth = loadAuth(settings);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const makeApp = new AsyncFunction(
    "express", "mongoose", "Event", "Booking", "setServers", "configureHosting",
    "authRouter", "createAuthSession", "loadCurrentUser", "requireLogin", "requireAdmin", "requireTrustedRequest", "fixture",
    serverSource + `
      authSessionMiddleware = await createAuthSession({});
      configureHosting(app, express, {
        env: { NODE_ENV: process.env.NODE_ENV, PORT: "3001", TRUST_PROXY_HOPS: process.env.NODE_ENV === "production" ? "1" : "0" },
        distDirectory: fixture,
      });
      app.use(handleError);
      return app;
    `
  );
  const app = await makeApp(express, {}, {}, {}, () => {}, configureHosting,
    auth.authRouter, auth.createAuthSession, auth.loadCurrentUser, auth.requireLogin,
    auth.requireAdmin, auth.requireTrustedRequest, fixture);
  const server = await new Promise((resolveListen, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolveListen(listener));
    listener.once("error", reject);
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    await callback(base, auth);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
}

const testPassword = "only-for-automated-tests-123";
function post(base, path, origin, { cookie, forwarded = true, body = {}, header = "EventBooking" } = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Origin: origin, "X-Requested-With": header,
      ...(forwarded ? { "X-Forwarded-Proto": "https" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

try {
  const local = express();
  assert.equal(configureHosting(local, express, { env: {}, distDirectory: fixture + "-missing" }), 3001);
  assert.equal(local.get("trust proxy"), 0);
  const hosted = express();
  assert.equal(configureHosting(hosted, express, {
    env: { NODE_ENV: "production", PORT: "10000", TRUST_PROXY_HOPS: "1" }, distDirectory: fixture,
  }), 10000);
  assert.equal(hosted.get("trust proxy"), 1);
  for (const PORT of ["0", "65536", "abc", "1.5"]) {
    assert.throws(() => configureHosting(express(), express, { env: { PORT } }), /PORT/);
  }
  assert.throws(() => configureHosting(express(), express, { env: { TRUST_PROXY_HOPS: "true" } }), /TRUST_PROXY_HOPS/);
  assert.throws(() => configureHosting(express(), express, {
    env: { NODE_ENV: "production" }, distDirectory: fixture + "-missing",
  }), /Frontend build missing/);

  await assert.rejects(loadAuth({ NODE_ENV: "production" }).createAuthSession({}), /APP_ORIGINS/);
  await assert.rejects(loadAuth({ NODE_ENV: "production", APP_ORIGINS: "http://app.example" }).createAuthSession({}), /HTTPS/);
  assert.throws(() => loadAuth({ APP_ORIGINS: "https://app.example/not-an-origin" }), /APP_ORIGINS/);

  const origin = "https://event-booking-check.onrender.com";
  await serve({ NODE_ENV: "production", RENDER: "true", RENDER_EXTERNAL_URL: origin }, async (base, auth) => {
    assert.match(await (await fetch(base + "/")).text(), /Hosting check/);
    assert.match(await (await fetch(base + "/assets/app.js")).text(), /hostingCheck/);
    const missing = await fetch(base + "/api/not-a-route");
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type"), /application\/json/);
    assert.equal((await missing.json()).message, "API route not found");
    assert.equal((await fetch(base + "/api/health")).status, 200);
    const hidden = await fetch(base + "/.env");
    assert.ok([403, 404].includes(hidden.status));
    assert.doesNotMatch(await hidden.text(), /DO_NOT_SERVE/);

    assert.equal((await post(base, "/api/auth/signup", "https://untrusted.example")).status, 403);
    assert.equal((await post(base, "/api/auth/signup", origin, { header: "" })).status, 403);
    let response = await post(base, "/api/auth/signup", origin, {
      body: { name: "Test", email: "test@example.com", password: testPassword, role: "ADMIN" },
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).user.role, "USER");
    const setCookie = response.headers.get("set-cookie");
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Lax/);
    const cookie = setCookie.split(";")[0];
    response = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie, "X-Forwarded-Proto": "https" } });
    assert.equal((await response.json()).user.email, "test@example.com");

    const lookupsBefore = auth.lookups();
    await fetch(base + "/", { headers: { Cookie: cookie } });
    assert.equal(auth.lookups(), lookupsBefore, "Static files must bypass API session/user loading");

    response = await post(base, "/api/auth/logout", origin, { cookie });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /; Secure/);
    response = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie, "X-Forwarded-Proto": "https" } });
    assert.equal((await response.json()).user, null);

    response = await post(base, "/api/auth/login", origin, {
      body: { email: "test@example.com", password: testPassword },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /; Secure/);
    response = await post(base, "/api/auth/login", origin, {
      forwarded: false, body: { email: "test@example.com", password: testPassword },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null, "Secure session cookie must not be sent over plain HTTP");
  });

  await serve({ NODE_ENV: "development" }, async base => {
    const response = await post(base, "/api/auth/signup", "http://localhost:5173", {
      forwarded: false, body: { name: "Local", email: "local@example.com", password: testPassword },
    });
    assert.equal(response.status, 201);
    assert.doesNotMatch(response.headers.get("set-cookie"), /; Secure/);
  });
  console.log("PASS: hosting configuration, static files, API 404s, trusted origins, HTTPS session cookies, login/logout and local development. Users and session storage were in memory; live MongoDB and Render were not tested.");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
