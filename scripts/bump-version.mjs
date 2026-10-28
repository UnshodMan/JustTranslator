#!/usr/bin/env node
// 统一更新项目版本号：package.json、package-lock.json、src-tauri/Cargo.toml、src-tauri/Cargo.lock。
// tauri.conf.json 通过 "../package.json" 引用版本，无需单独修改。
// 用法：npm run version:bump -- <patch|minor|major|x.y.z>

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  fail("用法: npm run version:bump -- <patch|minor|major|x.y.z>");
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const matched = SEMVER.exec(current);
if (!matched) {
  fail(`package.json 中的版本 "${current}" 不是 x.y.z 格式`);
}

let next = target;
if (["patch", "minor", "major"].includes(target)) {
  let [major, minor, patch] = matched.slice(1).map(Number);
  if (target === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (target === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  next = `${major}.${minor}.${patch}`;
} else if (!SEMVER.test(target)) {
  fail(`目标版本 "${target}" 无效，应为 patch|minor|major 或 x.y.z`);
}

if (next === current) {
  console.log(`版本号已经是 ${current}，无需修改`);
  process.exit(0);
}

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = next;
if (lock.packages?.[""]) {
  lock.packages[""].version = next;
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

let cargo = readFileSync(cargoPath, "utf8");
const sectionStart = cargo.indexOf("[package]");
if (sectionStart === -1) {
  fail("Cargo.toml 中未找到 [package] 段");
}
const sectionEnd = cargo.indexOf("\n[", sectionStart + 1);
const section = cargo.slice(sectionStart, sectionEnd === -1 ? cargo.length : sectionEnd);
const updatedSection = section.replace(/^version = ".*"$/m, `version = "${next}"`);
if (updatedSection === section) {
  fail("Cargo.toml 的 [package] 段中未找到 version 字段");
}
cargo = cargo.slice(0, sectionStart) + updatedSection + cargo.slice(sectionEnd === -1 ? cargo.length : sectionEnd);
writeFileSync(cargoPath, cargo);

let cargoLock = readFileSync(cargoLockPath, "utf8");
const cargoLockPattern = /(name = "just-translator"\nversion = ")[^"]*(")/;
if (!cargoLockPattern.test(cargoLock)) {
  fail('Cargo.lock 中未找到 name = "just-translator" 对应的 version');
}
writeFileSync(cargoLockPath, cargoLock.replace(cargoLockPattern, `$1${next}$2`));

console.log(`版本号 ${current} -> ${next}`);
console.log("已更新: package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock");
