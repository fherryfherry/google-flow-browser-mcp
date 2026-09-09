import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_HOME = path.resolve(__dirname, '..', '..');

const configPath = path.join(FLOW_HOME, 'config', 'flow.config.json');
let config;

try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw);
} catch (err) {
  console.error(`[CONFIG] Failed to load config from ${configPath}: ${err.message}`);
  config = {};
}

export default config;

export function get(key, fallback = undefined) {
  return config[key] !== undefined ? config[key] : fallback;
}

export function getFlowHome() {
  return config.flowHome || FLOW_HOME;
}

const DEFAULT_CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/opt/google/chrome/chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

export function getDefaultChromePath() {
  return config.chromePath || DEFAULT_CHROME_PATHS[process.platform] || DEFAULT_CHROME_PATHS.linux;
}
