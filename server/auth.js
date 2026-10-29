import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import User from "./models/User.js";

const COOKIE_NAME = "event_booking.sid";

const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3001",
];

const configuredOrigins = process.env.APP_ORIGINS?.trim() || (
  process.env.RENDER === "true" ? process.env.RENDER_EXTERNAL_URL?.trim() : ""
);

const allowedOrigins = new Set(
  (configuredOrigins || (process.env.NODE_ENV === "production" ? "" : defaultOrigins.join(",")))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) {
        throw new Error("APP_ORIGINS must contain only HTTP(S) origins, without paths or credentials");
      }
      return url.origin;
    })
);

let dummyHash;

function authError(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicUser(user) {
  return user ? {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
  } : null;
}

function cleanEmail(value) {
  if (
    typeof value !== "string" ||
    value.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    throw authError(400, "Enter a valid email address");
  }

  return value.trim().toLowerCase();
}

export async function createAuthSession(client) {
  if (
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32
  ) {
    throw new Error("SESSION_SECRET is missing or too short");
  }

  if (
    process.env.NODE_ENV === "production" &&
    !allowedOrigins.size
  ) {
    throw new Error("Set APP_ORIGINS before running in production (Render can supply RENDER_EXTERNAL_URL)");
  }
  if (process.env.NODE_ENV === "production" &&
      [...allowedOrigins].some((origin) => !origin.startsWith("https://"))) {
    throw new Error("Production APP_ORIGINS must use HTTPS");
  }

  await User.init();
  dummyHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

  const store = MongoStore.create({
    client,
    dbName: "event_booking",
    collectionName: "sessions",
    ttl: 8 * 60 * 60,
  });

  store.on("error", () => console.error("Session store error"));

  return session({
    name: COOKIE_NAME,
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      ...cookieOptions,
      maxAge: 8 * 60 * 60 * 1000,
    },
  });
}

export async function loadCurrentUser(req, res, next) {
  try {
    req.user = req.session?.userId
      ? await User.findById(req.session.userId)
      : null;

    next();
  } catch (error) {
    next(error);
  }
}

export function requireLogin(req, res, next) {
  if (!req.user) {
    return next(authError(401, "Please log in"));
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(authError(401, "Please log in"));
  }
  if (req.user.role !== "ADMIN") {
    return next(authError(403, "Admin access required"));
  }
  next();
}

export function requireTrustedRequest(req, res, next) {
  const origin = req.get("Origin");

  if (
    req.get("X-Requested-With") !== "EventBooking" ||
    (origin && !allowedOrigins.has(origin))
  ) {
    return next(authError(403, "Request not allowed"));
  }
  next();
}

function requireJson(req, res, next) {
  if (!req.is("application/json")) {
    return next(authError(415, "Send application/json"));
  }
  next();
}

async function signIn(req, user) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  req.session.userId = String(user._id);

  await new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Try again in 15 minutes.",
  },
});

export const authRouter = express.Router();

authRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

authRouter.get("/me", (req, res) => {
  res.json({
    success: true,
    user: publicUser(req.user),
  });
});

authRouter.post(
  "/signup",
  requireTrustedRequest,
  authLimiter,
  requireJson,
  async (req, res, next) => {
    try {
      const { name, email, password } = req.body ?? {};
      const normalizedEmail = cleanEmail(email);

      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100
      ) {
        throw authError(400, "Name must contain 1 to 100 characters");
      }

      if (
        typeof password !== "string" ||
        Buffer.byteLength(password, "utf8") > 72 ||
        [...password].length < 15
      ) {
        throw authError(
          400,
          "Password needs at least 15 characters and at most 72 UTF-8 bytes"
        );
      }

      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, 12),
        role: "USER",
      });

      await signIn(req, user);

      res.status(201).json({
        success: true,
        user: publicUser(user),
      });
    } catch (error) {
      next(
        error.code === 11000
          ? authError(409, "An account with this email already exists")
          : error
      );
    }
  }
);

authRouter.post(
  "/login",
  requireTrustedRequest,
  authLimiter,
  requireJson,
  async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      const normalizedEmail = cleanEmail(email);

      if (
        typeof password !== "string" ||
        !password.length ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        throw authError(401, "Invalid email or password");
      }

      const user = await User.findOne({
        email: normalizedEmail,
      }).select("+passwordHash");

      const valid = await bcrypt.compare(
        password,
        user?.passwordHash || dummyHash
      );

      if (!user || !valid) {
        throw authError(401, "Invalid email or password");
      }

      await signIn(req, user);

      res.json({
        success: true,
        user: publicUser(user),
      });
    } catch (error) {
      next(error);
    }
  }
);

authRouter.post(
  "/logout",
  requireTrustedRequest,
  async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => {
        req.session.destroy((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      res.clearCookie(COOKIE_NAME, cookieOptions);
      res.json({
        success: true,
        message: "Logged out",
      });
    } catch (error) {
      next(error);
    }
  }
);
