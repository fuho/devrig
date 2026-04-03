import { exit } from 'node:process';

const PREFIX = '[devrig]';

export function log(msg) {
  console.log(`${PREFIX} ${msg}`);
}

export function die(msg) {
  console.error(`${PREFIX} ERROR: ${msg}`);
  exit(1);
}
