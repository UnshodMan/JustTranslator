#!/usr/bin/env node
// 一键发版：更新版本号后自动提交、打标签并推送。
// 复用 scripts/bump-version.mjs 更新版本文件（package.json、package-lock.json、src-tauri/Cargo.toml、src-tauri/Cargo.lock）。
// 用法：npm run version:release -- <patch|minor|major|x.y.z> [--yes]

import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command) {
  try {
    return execSync(command, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim();
    fail(`命令执行失败: ${command}\n${detail}`);
  }
}

const args = process.argv.slice(2);
const skipConfirm = args.includes("--yes") || args.includes("-y");
const target = args.find((arg) => arg !== "--yes" && arg !== "-y");
if (!target) {
  fail("用法: npm run version:release -- <patch|minor|major|x.y.z> [--yes]");
}

// 前置检查：git 仓库、origin 远程、工作区干净、非 detached HEAD
run("git rev-parse --is-inside-work-tree");
if (!run("git remote").split("\n").includes("origin")) {
  fail("未找到 origin 远程，无法推送");
}
if (run("git status --porcelain") !== "") {
  fail("工作区不干净，请先提交或暂存当前改动后再发版");
}
const branch = run("git rev-parse --abbrev-ref HEAD");
if (branch === "HEAD") {
  fail("当前处于 detached HEAD 状态，请切换到分支后再发版");
}

// 执行 bump（复用现有脚本）
const bump = spawnSync(process.execPath, [path.join(root, "scripts", "bump-version.mjs"), target], {
  cwd: root,
  stdio: "inherit",
});
if (bump.status !== 0) {
  fail("版本号更新失败，已中止发版");
}

const next = JSON.parse(readFileSync(pkgPath, "utf8")).version;
const tag = `v${next}`;
const changed = run("git status --porcelain") !== "";

// 标签已存在时回滚 bump 产生的改动并中止
if (run(`git tag --list ${tag}`) !== "" || run(`git ls-remote --tags origin ${tag}`) !== "") {
  if (changed) {
    run(`git restore -- ${VERSION_FILES.join(" ")}`);
  }
  fail(`标签 ${tag} 已存在（本地或远程），已回滚版本文件改动`);
}

if (changed) {
  run(`git add ${VERSION_FILES.join(" ")}`);
  run(`git commit -m "Release ${tag}"`);
} else {
  console.log("版本文件无改动（版本号已是目标值），跳过提交");
}
run(`git tag ${tag}`);

const remoteUrl = run("git remote get-url origin");
console.log("");
console.log("即将执行以下操作:");
console.log(`  分支: ${branch} -> ${remoteUrl}`);
console.log(`  标签: ${tag} -> ${remoteUrl}（推送后将触发 GitHub Actions 创建草稿 Release）`);
if (!skipConfirm) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("确认推送? (y/N) ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    console.log(`已取消推送。标签 ${tag} 已在本地创建，可手动推送，或用 git tag -d ${tag} 删除`);
    process.exit(0);
  }
}

run(`git push origin ${branch}`);
run(`git push origin ${tag}`);
console.log("");
console.log(`发版完成: ${tag} 已推送，GitHub Actions 将自动创建草稿 Release`);
