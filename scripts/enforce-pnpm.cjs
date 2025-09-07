#!/usr/bin/env node
// Warn if user installs with npm or yarn instead of pnpm (helps avoid peer dep churn)
if (!process.env.npm_execpath) return;
const exec = process.env.npm_execpath.toLowerCase();
if (!exec.includes('pnpm')) {
  console.warn('\u001b[33m[warn] Please use pnpm to install dependencies for consistent resolution.\u001b[0m');
}
