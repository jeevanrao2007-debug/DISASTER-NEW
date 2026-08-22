import fs from 'fs';
import path from 'path';

const isProduction = process.env.NODE_ENV === 'production';

// Fallback parsing of local .env file for development environment
if (!isProduction) {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      let currentKey = null;
      let currentValue = [];
      let inQuote = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!currentKey) {
          if (!trimmed || trimmed.startsWith('#')) continue;
          const index = line.indexOf('=');
          if (index !== -1) {
            const key = line.substring(0, index).trim();
            let val = line.substring(index + 1).trim();
            if (val.startsWith("'") && !val.endsWith("'")) {
              inQuote = "'";
              currentKey = key;
              currentValue.push(line.substring(index + 1).trim().substring(1));
            } else if (val.startsWith('"') && !val.endsWith('"')) {
              inQuote = '"';
              currentKey = key;
              currentValue.push(line.substring(index + 1).trim().substring(1));
            } else {
              if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
                val = val.substring(1, val.length - 1);
              }
              if (process.env[key] === undefined) {
                process.env[key] = val;
              }
            }
          }
        } else {
          if (trimmed.endsWith(inQuote) || (inQuote === "'" && trimmed.endsWith("''"))) {
            const lineContent = line.trim();
            let lastIdx = line.lastIndexOf(inQuote);
            if (inQuote === "'" && lineContent.endsWith("''")) {
              lastIdx = line.lastIndexOf("''");
            }
            currentValue.push(line.substring(0, lastIdx));
            const finalVal = currentValue.join('\n');
            
            // Clean up any extra leading/trailing single/double quotes from multiline strings
            let cleanedVal = finalVal.trim();
            while (cleanedVal.endsWith("'") || cleanedVal.endsWith('"')) {
              cleanedVal = cleanedVal.substring(0, cleanedVal.length - 1).trim();
            }
            while (cleanedVal.startsWith("'") || cleanedVal.startsWith('"')) {
              cleanedVal = cleanedVal.substring(1).trim();
            }

            if (process.env[currentKey] === undefined) {
              process.env[currentKey] = cleanedVal;
            }
            currentKey = null;
            currentValue = [];
            inQuote = null;
          } else {
            currentValue.push(line);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Config] Failed to parse local .env file:', e.message);
  }
}

// Config abstraction object
export const config = {
  crisismeshApiUrl: process.env.CRISISMESH_API_URL || '',
  crisisIntegrationKey: process.env.CRISIS_INTEGRATION_KEY || '',
  enableCrisisIntegration: process.env.ENABLE_CRISIS_INTEGRATION === 'true',
  isProduction
};

// Validate variables and crash on invalid setup in production environment
export function validateConfig() {
  if (config.enableCrisisIntegration) {
    if (!config.crisismeshApiUrl || !config.crisisIntegrationKey) {
      const errorMsg = 'FATAL CONFIGURATION ERROR: CrisisMesh integration is enabled (ENABLE_CRISIS_INTEGRATION=true) but CRISISMESH_API_URL or CRISIS_INTEGRATION_KEY is missing.';
      console.error(errorMsg);
      if (isProduction) {
        throw new Error(errorMsg);
      }
    } else {
      console.log('[Config] CrisisMesh integration is secure and ENABLED.');
    }
  } else {
    console.log('[Config] CrisisMesh integration is DISABLED (standard mode).');
  }
}
