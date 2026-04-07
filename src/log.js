// @ts-check
import { exit } from 'node:process';

const PREFIX = '[devrig]';

let _verbose = false;

/** Enable or disable verbose logging. */
export function setVerbose(enabled) {
  _verbose = enabled;
}

/** Prints a message with [devrig] prefix. */
export function log(msg) {
  console.log(`${PREFIX} ${msg}`);
}

/** Prints a message only when --verbose is active. */
export function verbose(msg) {
  if (_verbose) console.log(`${PREFIX}:verbose ${msg}`);
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
