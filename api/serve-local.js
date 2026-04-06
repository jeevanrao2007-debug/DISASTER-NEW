import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
const staticPath = path.join(__dirname, "..");
app.use(express.static(staticPath));

async function runLocalHandler(modulePath, routeLabel, req, res) {
  const handler = (await import(modulePath)).default;
  const shouldLogBody = req.method === "POST" && req.body && Object.keys(req.body).length > 0;
  console.log(`[Local] -> ${req.method} ${routeLabel}`, shouldLogBody ? req.body : "");
  return handler(req, res);
}

// Mock Vercel serverless environment locally
app.all("/api/register", async (req, res) => {
  return runLocalHandler("./register.js", "/api/register", req, res);
});

app.all("/api/alert", async (req, res) => {
  return runLocalHandler("./alert.js", "/api/alert", req, res);
});

app.all("/api/dispatch-alert", async (req, res) => {
  return runLocalHandler("./dispatch-alert.js", "/api/dispatch-alert", req, res);
});

app.all("/api/runtime-config", async (req, res) => {
  return runLocalHandler("./runtime-config.js", "/api/runtime-config", req, res);
});

app.all("/api/cron", async (req, res) => {
  return runLocalHandler("./cron.js", "/api/cron", req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n================================`);
  console.log(`🚀 API Local Simulator running`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`================================\n`);
});
