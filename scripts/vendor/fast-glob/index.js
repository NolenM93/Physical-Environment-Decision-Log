'use strict';

/**
 * The published fast-glob package depends on micromatch, which depends on
 * braces. braces has no patched release. This project only needs globSync
 * for the Next.js ESLint plugin's rootDir lookup, so Node's own glob is enough.
 */

const fs = require('node:fs');
const path = require('node:path');

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function globSync(pattern, options = {}) {
  if (typeof fs.globSync !== 'function') {
    throw new Error('This fast-glob stand-in requires Node.js 22 or newer.');
  }

  const normalized = toPosix(String(pattern));
  const entries = fs.globSync(normalized, {
    cwd: options.cwd,
    withFileTypes: true,
    exclude: options.ignore,
  });

  const matches = [];
  for (const entry of entries) {
    if (options.onlyDirectories && !entry.isDirectory()) continue;
    if (options.onlyFiles && !entry.isFile()) continue;
    const parent = entry.parentPath || entry.path || '';
    matches.push(toPosix(path.join(parent, entry.name)));
  }
  return matches;
}

module.exports = { globSync, sync: globSync };
