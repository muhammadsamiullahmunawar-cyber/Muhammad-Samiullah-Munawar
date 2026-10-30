import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const serverSource = path.join(__dirname, "server.js");
const targetDir = path.join(rootDir, "dist", "server");
const targetFile = path.join(targetDir, "server.js");

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.copyFileSync(serverSource, targetFile);
console.log(`[build-server] Successfully copied server entry to ${targetFile}`);
