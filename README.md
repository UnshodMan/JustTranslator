# JustTranslator

基于 Tauri 2 + Vue 3 + TypeScript 的轻量跨平台翻译桌面应用。

## 功能

- 多翻译源支持：百度翻译（需 AppID/密钥）、Google 翻译、微软 Bing 翻译（后两者免登录、无需凭据）。
- 源语言自动检测、语言互换、译文分段展示与一键复制。
- 朗读：原文与译文均可一键朗读，默认朗读英语；支持系统语音（离线）与 Google 在线语音（音色自然），译文可自动朗读，语速可调。
- 自动切换语言方向：输入中文时目标语言切到英语，输入英语时切到中文；输入其他语言时源语言切到"自动检测"，由翻译源识别源语言（可在语言栏的"自动切换"开关或设置中关闭）。
- 自动翻译：停止输入后自动调用翻译接口，无需手动点击翻译按钮（可在设置中关闭）。
- 翻译源凭据由设置界面配置，优先保存在系统钥匙串中；钥匙串不可用时自动回退为配置文件明文。
- 翻译源通过统一接口注册，新增翻译源无需改动 Rust。

## 技术栈

| 层         | 技术                                                     |
| ---------- | -------------------------------------------------------- |
| 桌面外壳   | Tauri 2（Rust，仅负责启动、插件注册与钥匙串访问）        |
| 前端       | Vue 3 + TypeScript + Vite                                |
| 网络请求   | `@tauri-apps/plugin-http`（绕过 WebView 的 CORS 限制） |
| 配置存储   | `@tauri-apps/plugin-fs`（写入系统应用配置目录）        |
| 凭据存储   | `keyring`（macOS Keychain / Windows 凭据管理器 / Linux Secret Service） |
| 签名       | `js-md5`                                               |

## 目录结构

```text
.
├── index.html                  # Vite 入口页面
├── package.json                # 前端依赖与脚本
├── vite.config.ts              # Vite 配置
├── tsconfig.json               # TypeScript 配置
├── src/                        # 前端与全部业务逻辑（TypeScript）
│   ├── main.ts                 # Vue 应用挂载
│   ├── App.vue                 # 主界面：语言选择、翻译、复制、设置入口
│   ├── api.ts                  # 业务逻辑统一入口，供组件调用
│   ├── types.ts                # 共享类型定义
│   ├── style.css               # 全局样式
│   ├── components/
│   │   ├── AppSelect.vue        # 自定义下拉组件：替代原生 select，统一弹出列表样式
│   │   └── SettingsModal.vue    # 设置弹窗：翻译源、凭据、朗读
│   └── services/
│       ├── config.ts           # 配置的读取、默认值与持久化（不含凭据）
│       ├── credentials.ts      # 翻译源凭据的钥匙串读写与旧数据迁移
│       ├── language-detect.ts  # 根据输入内容自动识别语言方向
│       ├── speech.ts           # 朗读：系统语音与 Google 在线语音双引擎
│       └── translator/
│           ├── provider.ts     # 翻译源接口定义
│           ├── index.ts        # 翻译源注册表
│           ├── languages.ts    # 通用语言代码与名称
│           ├── baidu.ts        # 百度翻译实现（签名、请求、错误码映射）
│           ├── google.ts       # Google 翻译实现（免登录网页接口）
│           └── microsoft.ts    # 微软 Bing 翻译实现（免登录网页接口）
└── src-tauri/                  # Tauri 桌面外壳
    ├── Cargo.toml              # Rust 依赖
    ├── tauri.conf.json         # 窗口、打包、构建配置
    ├── capabilities/
    │   └── default.json        # 前端可用的系统权限声明
    ├── icons/                  # 应用图标
    └── src/
        ├── main.rs             # 程序入口
        └── lib.rs              # Tauri Builder：注册插件、钥匙串命令并启动
```

## 关键文件说明

- `src/api.ts`：组件与业务逻辑之间的唯一入口，导出 `listProviders`、`loadAppState`、`saveSettings`、`saveConfig`、`translate`、`speak`、`stopSpeaking`、`getConfigFilePath`。
- `src/services/translator/provider.ts`：翻译源接口，任何翻译源只需实现 `info` 和 `translate`。
- `src/services/translator/index.ts`：翻译源注册表。新增翻译源时在此处加入数组即可。
- `src/services/translator/baidu.ts`：百度翻译的完整实现，包括 `md5(appId + 文本 + salt + 密钥)` 签名、表单请求和错误码提示。
- `src/services/translator/google.ts`：Google 翻译网页接口实现，使用 `translate_a/single` 免登录接口，无需凭据；需要网络可访问 Google。
- `src/services/translator/microsoft.ts`：微软 Bing 翻译网页接口实现，从 `bing.com/translator` 页面获取短时令牌并缓存，无需凭据。
- `src/services/config.ts`：负责 `config.json` 的读取与写入；配置缺失或损坏时回退到默认值。钥匙串不可用时，凭据会以 `providerSettings` 明文保存在该文件中。
- `src/services/credentials.ts`：通过 Tauri 命令读写系统钥匙串，按“翻译源 ID.字段 key”组织条目；空值会删除对应条目，并负责把配置文件中的明文凭据同步回钥匙串。
- `src/services/speech.ts`：朗读服务。系统引擎走 Web Speech API（离线、支持语速）；在线引擎调用 Google `translate_tts` 接口，按句切分后分段请求并顺序播放；`auto` 模式下系统无对应语言音色时自动回退在线。
- `src-tauri/src/lib.rs`：Rust 侧只保留 Tauri 启动、`fs`、`http` 插件注册，以及访问系统钥匙串的 `keychain_get`、`keychain_set`、`keychain_delete` 命令。
- `src-tauri/capabilities/default.json`：声明前端所需的系统权限，例如各翻译源 API 域名访问、应用配置目录读写。

## 配置文件

配置保存在系统应用配置目录下的 `config.json`：

- Linux：`~/.config/com.justtranslator.desktop/config.json`
- macOS：`~/Library/Application Support/com.justtranslator.desktop/config.json`
- Windows：`%APPDATA%\com.justtranslator.desktop\config.json`

实际路径会显示在设置弹窗底部。主要字段：

```json
{
  "activeProvider": "baidu",
  "sourceLang": "auto",
  "targetLang": "zh",
  "autoDirection": true,
  "autoTranslate": true,
  "speechEngine": "auto",
  "speechRate": 1.0,
  "autoSpeak": false
}
```

翻译源凭据优先保存在系统钥匙串中：

- macOS：Keychain（服务名为 `com.justtranslator.desktop`）
- Windows：凭据管理器
- Linux：Secret Service（GNOME Keyring、KWallet 等）

若系统钥匙串不可用，应用会自动降级为明文保存：凭据写入 `config.json` 的 `providerSettings` 字段，翻译功能保持可用。之后钥匙串恢复可用时，明文凭据会自动同步回钥匙串并从配置文件中移除。旧版配置文件中的 `providerSettings` 也会按同样方式迁移。

## 开发与构建

环境要求：Node.js 22 LTS+（≥ 22.12.0，与 `.nvmrc` 和 `package.json` 的 `engines` 一致）、Rust 1.77+，以及对应平台的 Tauri 系统依赖。

```bash
npm install        # 安装前端依赖
npm run dev        # 仅启动前端（浏览器中运行，无法使用桌面系统能力）
npm run tauri dev  # 启动完整桌面应用（推荐）
npm run build      # TypeScript 类型检查 + 前端构建
npm run lint       # ESLint 代码检查（--fix 可自动修复）
npm run tauri build # 打包桌面安装包
```

### 版本号管理

版本号以 `package.json` 的 `version` 为唯一来源：`src-tauri/tauri.conf.json` 通过 `"version": "../package.json"` 直接引用，其余文件由脚本同步更新。

```bash
npm run version:bump -- patch   # 0.1.0 -> 0.1.1
npm run version:bump -- minor   # 0.1.0 -> 0.2.0
npm run version:bump -- major   # 0.1.0 -> 1.0.0
npm run version:bump -- 0.2.3   # 直接指定版本
```

脚本 [scripts/bump-version.mjs](scripts/bump-version.mjs) 会同时更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock`。发布时先执行 bump，再提交改动并推送 `v` 前缀标签（如 `git tag v0.2.0 && git push origin v0.2.0`）。不要单独使用 `npm version`，否则 Rust 侧版本会不同步。

## 持续集成与打包

GitHub Actions 配置位于 `.github/workflows/build.yml`，可在一次运行中同时构建三个平台的安装包：

| 平台    | Runner          | 产物                                        |
| ------- | --------------- | ------------------------------------------- |
| Linux   | `ubuntu-22.04`  | `.deb`、`.rpm`、`.AppImage`                 |
| Windows | `windows-latest` | NSIS `.exe`                                  |
| macOS   | `macos-latest`  | 通用架构（Apple Silicon + Intel）`.dmg`/`.app` |

Windows 的 NSIS 安装程序（`-setup.exe`）内置英文与简体中文界面，默认跟随系统语言自动切换；系统语言不在列表中时回退英文。需要更多语言时，在 `src-tauri/tauri.conf.json` 的 `bundle.windows.nsis.languages` 数组中加入对应的 NSIS 语言名即可。

触发方式：

- 推送 `v*` 标签（如 `git tag v0.1.0 && git push origin v0.1.0`）：自动创建草稿 Release，并把各平台安装包上传到该 Release。
- 在 Actions 页面手动触发 `Build`（workflow_dispatch）：安装包以 workflow artifacts 形式保留，可直接下载。

macOS 安装包为通用二进制，构建时同时安装 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` 目标。当前产物未做代码签名（macOS 未公证、Windows 未签名），安装时系统可能提示来源未知；如需正式分发，需补充 Apple Developer ID、公证以及 Windows 代码签名证书对应的 secrets 与 `tauri.conf.json` 签名配置。

## 新增翻译源

1. 在 `src/services/translator/` 下新建文件，实现 `TranslationProvider` 接口。
2. 在 `src/services/translator/index.ts` 的 `providers` 数组中注册。
3. 若需要访问新的 API 域名，在 `src-tauri/capabilities/default.json` 的 `http:default` 允许列表中加入对应 URL。

前端设置界面会根据 `ProviderInfo.fields` 自动渲染凭据表单，无需额外改造。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
