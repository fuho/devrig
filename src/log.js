// @ts-check
import { exit } from 'node:process';

const PREFIX = '[devrig]';

/** Prints a message with [devrig] prefix. */
export function log(msg) {
  console.log(`${PREFIX} ${msg}`);
}

/**
 * Prints an error with [devrig] prefix and exits with code 1.
 * @param {string} msg
 * @returns {never}
 */
export function die(msg) {
  console.error(`${PREFIX} ERROR: ${msg}`);
  exit(1);
}
