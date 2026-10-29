import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Call after the API routes, before the shared error handler and app.listen().
export function configureHosting(app, express, options = {}) {
  const env = options.env || process.env;
  const portText = env.PORT || "3001";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const proxyText = env.TRUST_PROXY_HOPS || "0";
  const proxyHops = Number(proxyText);
  if (!/^\d+$/.test(proxyText) || !Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10");
  }

  const production = env.NODE_ENV === "production";
  const distDirectory = options.distDirectory || fileURLToPath(new URL("../client/dist/", import.meta.url));
  if (production && !existsSync(join(distDirectory, "index.html"))) {
    throw new Error("Frontend build missing. Run npm --prefix client run build from the repository root.");
  }

  // Render's public HTTP endpoint is behind its reverse proxy. Local dev uses 0.
  // Other hosting topologies must set this to their actual trusted hop count.
  app.set("trust proxy", proxyHops);
  app.disable("x-powered-by");

  // An unknown API URL must return JSON, never the frontend's index.html.
  app.use("/api", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(404).json({ success: false, message: "API route not found" });
  });

  if (production) {
    app.use(express.static(distDirectory, {
      index: "index.html",
      dotfiles: "deny",
      maxAge: 0,
    }));
  }

  return port;
}
