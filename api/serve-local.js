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

// Mock Vercel serverless environment locally
app.post("/api/register", async (req, res) => {
  const handler = (await import("./register.js")).default;
  console.log("[Local] -> POST /api/register");
  return handler(req, res);
});

app.post("/api/alert", async (req, res) => {
  const handler = (await import("./alert.js")).default;
  console.log("[Local] -> POST /api/alert", req.body);
  return handler(req, res);
});

app.get("/api/cron", async (req, res) => {
  const handler = (await import("./cron.js")).default;
  console.log("[Local] -> GET /api/cron");
  return handler(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n================================`);
  console.log(`🚀 API Local Simulator running`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`================================\n`);
});
