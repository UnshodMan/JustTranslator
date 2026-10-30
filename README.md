# JustTranslator

基于 Tauri 2 + Vue 3 + TypeScript 的轻量跨平台翻译桌面应用。

## 功能

- 多翻译源支持：百度翻译（需 AppID/密钥）、Google 翻译、微软 Bing 翻译（后两者免登录、无需凭据）。
- 图片翻译：基于百度图片翻译 API V2.0，入口仅在当前翻译源为百度翻译时显示；AppID 与文本翻译共用，只需额外配置 API Key。支持点击选择、拖拽或直接粘贴截图；可返回整图贴合的译文图片或仅返回识别与译文文本，译文图片可保存到系统下载目录。原图与译文图片均支持点击在独立窗口中放大预览，可用滚轮缩放、左键拖拽平移。
- 源语言自动检测、语言互换、译文分段展示与一键复制。
- 朗读：原文与译文均可一键朗读，默认朗读英语；支持系统语音（离线）与 Google 在线语音（音色自然），译文可自动朗读，语速可调。
- 自动切换语言方向：输入中文时目标语言切到英语，输入英语时切到中文；输入其他语言时源语言切到"自动检测"，由翻译源识别源语言（可在语言栏的"自动切换"开关或设置中关闭）。
- 自动翻译：停止输入后自动调用翻译接口，无需手动点击翻译按钮（可在设置中关闭）。
- 主题切换：顶栏按钮一键循环切换明亮、暗黑、跟随系统，选择会保存到配置文件；跟随系统时实时响应系统明暗变化。
- 翻译源凭据由设置界面配置，优先保存在系统钥匙串中；钥匙串不可用时自动回退为配置文件明文。
- 翻译源通过统一接口注册，新增翻译源无需改动 Rust。

## 技术栈

| 层         | 技术                                                     |
| ---------- | -------------------------------------------------------- |
| 桌面外壳   | Tauri 2（Rust，仅负责启动、插件注册与钥匙串访问）        |
| 前端       | Vue 3 + TypeScript + Vite                                |
| 网络请求   | `@tauri-apps/plugin-http`（绕过 WebView 的 CORS 限制） |
| 配置存储   | `@tauri-apps/plugin-fs`（写入系统应用配置目录）        |
| 外部链接   | `@tauri-apps/plugin-opener`（用系统浏览器打开申请与文档链接） |
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
│   ├── main.ts                 # Vue 应用挂载入口，URL 带 ?preview 时挂载图片预览窗口页面
│   ├── App.vue                 # 主界面：语言选择、翻译、复制、设置入口
│   ├── ImagePreviewWindow.vue  # 图片预览独立窗口页面：滚轮缩放、左键拖拽平移
│   ├── api.ts                  # 业务逻辑统一入口，供组件调用
│   ├── types.ts                # 共享类型定义
│   ├── style.css               # 全局样式
│   ├── components/
│   │   ├── AppSelect.vue        # 自定义下拉组件：替代原生 select，统一弹出列表样式
│   │   ├── ImageTranslator.vue  # 图片翻译：选择/拖拽/粘贴图片、贴合方式与译文图片保存
│   │   └── SettingsModal.vue    # 设置弹窗：翻译源、图片翻译凭据、朗读
│   └── services/
│       ├── config.ts           # 配置的读取、默认值与持久化（不含凭据）
│       ├── credentials.ts      # 翻译源凭据的钥匙串读写与旧数据迁移
│       ├── external-links.ts   # 用系统浏览器打开凭据申请与接口文档链接
│       ├── language-detect.ts  # 根据输入内容自动识别语言方向
│       ├── speech.ts           # 朗读：系统语音与 Google 在线语音双引擎
│       ├── theme.ts            # 主题：明亮/暗黑/跟随系统的应用与系统偏好监听
│       └── translator/
│           ├── provider.ts     # 文本翻译源接口定义
│           ├── index.ts        # 文本翻译源注册表
│           ├── languages.ts    # 通用语言代码与名称
│           ├── baidu.ts        # 百度翻译实现（签名、请求、错误码映射）
│           ├── google.ts       # Google 翻译实现（免登录网页接口）
│           ├── microsoft.ts    # 微软 Bing 翻译实现（免登录网页接口）
│           ├── image-provider.ts # 图片翻译源接口定义
│           ├── image-index.ts  # 图片翻译源注册表
│           └── baidu-image.ts  # 百度图片翻译 V2.0 实现（Bearer 鉴权、贴合图与分段）
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

- `src/api.ts`：组件与业务逻辑之间的唯一入口，导出 `listProviders`、`listImageProviders`、`loadAppState`、`saveSettings`、`saveConfig`、`translate`、`translateImage`、`speak`、`stopSpeaking`、`getConfigFilePath`。
- `src/services/translator/provider.ts`：文本翻译源接口，任何翻译源只需实现 `info` 和 `translate`，并在 `index.ts` 的 `providers` 数组中注册。
- `src/services/translator/image-provider.ts`：图片翻译源接口，实现 `info` 与 `translateImage`；注册表与文本翻译源分开（`image-index.ts`），避免图片翻译源出现在文本翻译下拉框中。
- `src/ImagePreviewWindow.vue`：图片预览独立窗口页面。与主窗口共用同一入口页面（URL 带 `?preview` 时挂载），通过 localStorage 读取图片数据，点击空白处或按 Esc 关闭窗口；浏览器预览模式下退回新标签页。
- `src/services/credentials.ts`：通过 Tauri 命令读写系统钥匙串，按“翻译源 ID.字段 key”组织条目；文本与图片翻译源的凭据共用同一套读写逻辑。空值会删除对应条目，并负责把配置文件中的明文凭据同步回钥匙串。
- `src/services/speech.ts`：系统引擎走 Web Speech API（离线、支持语速）；在线引擎调用 Google `translate_tts` 接口，按句切分后分段请求并顺序播放；`auto` 模式下系统无对应语言音色时自动回退在线。

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
  "theme": "system",
  "speechEngine": "auto",
  "speechRate": 1.0,
  "autoSpeak": false,
  "imageSourceLang": "auto",
  "imageTargetLang": "zh"
}
```

翻译源凭据优先保存在系统钥匙串中：

- macOS：Keychain（服务名为 `com.justtranslator.desktop`）
- Windows：凭据管理器
- Linux：Secret Service（GNOME Keyring、KWallet 等）

若系统钥匙串不可用，应用会自动降级为明文保存：凭据写入 `config.json` 的 `providerSettings` 字段，翻译功能保持可用。之后钥匙串恢复可用时，明文凭据会自动同步回钥匙串并从配置文件中移除。旧版配置文件中的 `providerSettings` 也会按同样方式迁移。

## 图片翻译

图片翻译目前只注册了百度图片翻译 API V2.0：没有稳定、公开且免登录的图片翻译网页接口，因此未添加其他图片翻译源。图片翻译入口（模式切换按钮）与设置弹窗中的凭据区块，仅在当前翻译源为百度翻译时显示。

- 接口地址：`https://fanyi-api.baidu.com/ait/api/picture/translate`，`POST` + JSON，`Authorization: Bearer <API Key>`。
- 凭据：AppID 与文本翻译（百度翻译）共用，无需重复填写；API Key 需在管理控制台的 APIKey 管理中单独创建（Bearer 鉴权使用）。
- 限制：仅支持 PNG、JPG，原图不超过 5 MB。
- 模式：整图贴合返回翻译后的图片，仅文本返回识别与译文；图片翻译结果可保存到系统下载目录（`$DOWNLOAD`），浏览器预览模式下退回浏览器下载。
- 未配置凭据时，文本翻译与图片翻译的提示栏、设置弹窗都会显示百度官方的“开通服务 / 创建 API Key / 查看 AppID / 接口文档”链接，点击后用系统浏览器打开。

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

脚本 [scripts/bump-version.mjs](scripts/bump-version.mjs) 会同时更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock`。不要单独使用 `npm version`，否则 Rust 侧版本会不同步。

发版推荐使用 [scripts/release.mjs](scripts/release.mjs) 一键完成：更新版本号后自动提交版本文件、创建 `v` 前缀标签并推送当前分支与标签（要求工作区干净，推送前需确认，传 `--yes` 可跳过确认）：

```bash
npm run version:release -- patch        # bump + 提交 + 打标签 v0.1.1 + 推送
npm run version:release -- 0.2.3 --yes  # 直接指定版本并跳过推送确认
```

标签推送后会触发 GitHub Actions 创建草稿 Release（见下文）。仅更新版本号不发版时，继续使用 `version:bump`，之后手动提交并推送标签（如 `git tag v0.2.0 && git push origin v0.2.0`）即可。

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

文本翻译源：

1. 在 `src/services/translator/` 下新建文件，实现 `TranslationProvider` 接口。
2. 在 `src/services/translator/index.ts` 的 `providers` 数组中注册。
3. 若需要访问新的 API 域名，在 `src-tauri/capabilities/default.json` 的 `http:default` 允许列表中加入对应 URL。

图片翻译源：

1. 实现 `src/services/translator/image-provider.ts` 中的 `ImageTranslationProvider` 接口。
2. 在 `src/services/translator/image-index.ts` 的 `imageProviders` 数组中注册；凭据会自动出现在设置弹窗的“图片翻译”区块。若与某个文本翻译源共用凭据（如百度图片翻译共用文本翻译的 AppID），在实现中声明 `credentialsFrom` 指向该翻译源 ID，调用时会自动合并其凭据。
3. 同样把 API 域名加入 `http:default` 允许列表。

前端设置界面会根据 `ProviderInfo.fields` 自动渲染凭据表单，无需额外改造。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
