// Read / write the recorded migration oracle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ORACLE = path.join(HERE, 'rt3d-oracle.json');

export function readOracle() {
  if (!fs.existsSync(ORACLE)) return null;
  return JSON.parse(fs.readFileSync(ORACLE, 'utf8'));
}

export function writeOracle(data) {
  fs.writeFileSync(ORACLE, JSON.stringify(data, null, 2) + '\n');
}
