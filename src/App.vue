<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppSelect from "./components/AppSelect.vue";
import ImageTranslator from "./components/ImageTranslator.vue";
import SettingsModal from "./components/SettingsModal.vue";
import {
  getConfigFilePath,
  listImageProviders,
  listProviders,
  loadAppState,
  saveConfig,
  saveSettings,
  speak as speakApi,
  stopSpeaking,
  translate as translateApi,
} from "./api";
import { detectDirection } from "./services/language-detect";
import { openExternalUrl } from "./services/external-links";
import { applyTheme, getSystemTheme } from "./services/theme";
import type {
  AppConfig,
  ProviderCredentials,
  ProviderInfo,
  ThemeMode,
  TranslateResponse,
} from "./types";

/** 当前工作模式：文本翻译或图片翻译。 */
type WorkspaceMode = "text" | "image";

const providers = ref<ProviderInfo[]>([]);
const imageProviders = ref<ProviderInfo[]>([]);
const mode = ref<WorkspaceMode>("text");
const config = ref<AppConfig | null>(null);
const credentials = ref<ProviderCredentials>({});
/** 系统钥匙串是否可用；不可用时凭据来自配置文件明文。 */
const keychainAvailable = ref(true);
const configPath = ref("");

const text = ref("");
const result = ref<TranslateResponse | null>(null);
const error = ref("");
const loading = ref(false);
const copied = ref(false);
const booting = ref(true);
const settingsOpen = ref(false);
const settingsError = ref("");
/** 当前正在朗读的面板，未朗读时为 null。 */
const speaking = ref<"source" | "result" | null>(null);

let copyTimer: ReturnType<typeof setTimeout> | undefined;
let autoTranslateTimer: ReturnType<typeof setTimeout> | undefined;
/** 每次请求递增；过期响应会被丢弃。 */
let translateSeq = 0;
/** 每次朗读调用递增；过期的朗读回调会被丢弃。 */
let speakSeq = 0;

const activeProvider = computed(
  () => providers.value.find((p) => p.id === config.value?.activeProvider) ?? null,
);
const activeImageProvider = computed(() => imageProviders.value[0] ?? null);
/**
 * 图片翻译目前仅接入百度，且与百度文本翻译共用凭据，
 * 因此只有当前翻译源为百度翻译时才显示图片翻译入口。
 */
const imageModeAvailable = computed(
  () =>
    imageProviders.value.length > 0 && config.value?.activeProvider === "baidu",
);
/** 当前模式下实际使用的翻译源。 */
const currentProvider = computed(() =>
  mode.value === "image" ? activeImageProvider.value : activeProvider.value,
);

const sourceLanguages = computed(() => currentProvider.value?.languages ?? []);
const targetLanguages = computed(() =>
  (currentProvider.value?.languages ?? []).filter((l) => l.code !== "auto"),
);
const currentSourceLang = computed(() =>
  mode.value === "image"
    ? config.value?.imageSourceLang ?? "auto"
    : config.value?.sourceLang ?? "auto",
);
const currentTargetLang = computed(() =>
  mode.value === "image"
    ? config.value?.imageTargetLang ?? "zh"
    : config.value?.targetLang ?? "zh",
);

const providerOptions = computed(() =>
  providers.value.map((p) => ({ value: p.id, label: p.name })),
);
const sourceOptions = computed(() =>
  sourceLanguages.value.map((l) => ({ value: l.code, label: l.label })),
);
const targetOptions = computed(() =>
  targetLanguages.value.map((l) => ({ value: l.code, label: l.label })),
);

const missingSettings = computed(() => {
  const provider = currentProvider.value;
  if (!provider) return false;
  const values = credentials.value[provider.id] ?? {};
  if (provider.fields.some((field) => !values[field.key]?.trim())) return true;
  // 图片翻译与百度文本翻译共用 AppID，缺失时同样提示去设置。
  return mode.value === "image" && !credentials.value["baidu"]?.appId?.trim();
});

const canTranslate = computed(
  () => !loading.value && text.value.trim().length > 0 && !!config.value,
);

/** 主题切换按钮的文案。 */
const themeLabels: Record<ThemeMode, string> = {
  light: "明亮",
  dark: "暗黑",
  system: "跟随系统",
};

const currentTheme = computed<ThemeMode>(
  () => config.value?.theme ?? "system",
);

// 配置加载完成后应用保存的主题；跟随系统时系统明暗变化由主题服务实时同步。
watch(currentTheme, (mode) => applyTheme(mode), { immediate: true });

/**
 * 循环切换主题：跟随系统时优先切到系统当前明暗的反色，
 * 再切到另一个明确主题，最后回到跟随系统。
 * 例如系统为暗黑时顺序为：跟随系统 → 明亮 → 暗黑 → 跟随系统。
 */
function cycleTheme() {
  const systemTheme = getSystemTheme();
  const order: ThemeMode[] = [
    "system",
    systemTheme === "dark" ? "light" : "dark",
    systemTheme,
  ];
  const index = order.indexOf(currentTheme.value);
  const next = order[(index + 1) % order.length];
  void updateConfig({ theme: next });
}

/**
 * 朗读原文面板时使用的语言：取配置的源语言，
 * 源语言设为自动时改用检测到的语言。
 */
const sourceSpeakLang = computed(() => {
  if (!config.value) return "en";
  if (config.value.sourceLang !== "auto") return config.value.sourceLang;
  const detected = detectDirection(text.value)?.from;
  return result.value?.from ?? (detected && detected !== "auto" ? detected : "en");
});

onMounted(async () => {
  try {
    const [providerList, imageProviderList, state, path] = await Promise.all([
      listProviders(),
      listImageProviders(),
      loadAppState(),
      getConfigFilePath(),
    ]);
    providers.value = providerList;
    imageProviders.value = imageProviderList;
    config.value = normalizeConfig(
      state.config,
      providerList,
      imageProviderList,
    );
    credentials.value = state.credentials;
    keychainAvailable.value = state.keychainAvailable;
    configPath.value = path;
    if (JSON.stringify(config.value) !== JSON.stringify(state.config)) {
      await saveConfig(config.value);
    }
  } catch (e) {
    error.value = `初始化失败：${String(e)}`;
  } finally {
    booting.value = false;
  }
});

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
  if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
  stopSpeaking();
});

/** 停止当前播放，并作废尚未完成的朗读回调。 */
function haltSpeech() {
  speakSeq++;
  speaking.value = null;
  stopSpeaking();
}

/** 开始朗读指定面板的文本，通过递增序号丢弃已过期的回调。 */
function startSpeaking(which: "source" | "result", content: string, lang: string) {
  const trimmed = content.trim();
  if (!trimmed || !config.value) return;
  const seq = ++speakSeq;
  speaking.value = which;
  void speakApi({
    text: trimmed,
    lang,
    onEnd: () => {
      if (seq === speakSeq) speaking.value = null;
    },
    onError: (message) => {
      if (seq !== speakSeq) return;
      speaking.value = null;
      error.value = message;
    },
  });
}

/** 点击喇叭按钮：该面板正在朗读则停止，否则开始朗读对应文本。 */
function toggleSpeak(which: "source" | "result") {
  if (!config.value) return;
  if (speaking.value === which) {
    haltSpeech();
    return;
  }
  if (which === "source") {
    startSpeaking("source", text.value, sourceSpeakLang.value);
  } else if (result.value) {
    startSpeaking("result", result.value.text, config.value.targetLang);
  }
}

/** 确保存储的语言代码对当前启用的翻译源始终合法。 */
function normalizeConfig(
  input: AppConfig,
  list: ProviderInfo[],
  imageList: ProviderInfo[],
): AppConfig {
  const next: AppConfig = JSON.parse(JSON.stringify(input));
  const provider =
    list.find((p) => p.id === next.activeProvider) ?? list[0] ?? null;
  if (provider) {
    next.activeProvider = provider.id;
    if (!provider.languages.some((l) => l.code === next.sourceLang)) {
      next.sourceLang = "auto";
    }
    if (
      !provider.languages.some(
        (l) => l.code === next.targetLang && l.code !== "auto",
      )
    ) {
      next.targetLang =
        provider.languages.find((l) => l.code !== "auto")?.code ?? "zh";
    }
  }

  const imageProvider = imageList[0] ?? null;
  if (imageProvider) {
    if (!imageProvider.languages.some((l) => l.code === next.imageSourceLang)) {
      next.imageSourceLang = "auto";
    }
    if (
      !imageProvider.languages.some(
        (l) => l.code === next.imageTargetLang && l.code !== "auto",
      )
    ) {
      next.imageTargetLang =
        imageProvider.languages.find((l) => l.code !== "auto")?.code ?? "zh";
    }
  }
  return next;
}

/** 合并配置变更并持久化；保存失败时把错误显示到界面上。 */
async function updateConfig(patch: Partial<AppConfig>) {
  if (!config.value) return;
  const next = { ...config.value, ...patch };
  config.value = next;
  try {
    await saveConfig(next);
  } catch (e) {
    error.value = `保存设置失败：${String(e)}`;
  }
}

/**
 * 按输入文本推断的方向调整语言栏。该变更只保留在内存中：
 * 每次按键都写配置文件会很浪费，而且方向会随输入变化重新计算。
 * 输入既非中文也非英文时，源语言切到"自动检测"，目标语言保持不变。
 */
function applyAutoDirection() {
  if (mode.value !== "text") return;
  if (!config.value?.autoDirection) return;
  const direction = detectDirection(text.value);
  if (!direction) return;

  const supported = new Set(activeProvider.value?.languages.map((l) => l.code));
  if (!supported.has(direction.from)) return;
  if (direction.to && !supported.has(direction.to)) return;

  const targetLang = direction.to ?? config.value.targetLang;
  if (
    config.value.sourceLang === direction.from &&
    config.value.targetLang === targetLang
  ) {
    return;
  }
  config.value = {
    ...config.value,
    sourceLang: direction.from,
    targetLang,
  };
}

watch(text, (value) => {
  if (mode.value !== "text") return;
  applyAutoDirection();

  if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
  autoTranslateTimer = undefined;
  // 输入被清空时同步清掉译文与错误，并作废仍在进行的翻译请求。
  if (!value.trim()) {
    translateSeq++;
    loading.value = false;
    haltSpeech();
    result.value = null;
    error.value = "";
    return;
  }

  // 输入停止片刻后自动翻译。
  if (!config.value?.autoTranslate) return;
  autoTranslateTimer = setTimeout(() => {
    autoTranslateTimer = undefined;
    void doTranslate();
  }, 500);
});

/** 切换翻译源：语言方向重置为该源支持的合法值，清空旧译文并停止朗读。 */
function changeProvider(id: string) {
  if (!config.value) return;
  const provider = providers.value.find((p) => p.id === id);
  if (!provider) return;
  const next = normalizeConfig(
    { ...config.value, activeProvider: id },
    providers.value,
    imageProviders.value,
  );
  haltSpeech();
  result.value = null;
  void updateConfig(next);
}

/** 切换源语言，停止朗读并清空旧译文。 */
function changeSource(value: string) {
  haltSpeech();
  result.value = null;
  if (mode.value === "image") {
    void updateConfig({ imageSourceLang: value });
  } else {
    void updateConfig({ sourceLang: value });
  }
}

/** 切换目标语言，停止朗读并清空旧译文。 */
function changeTarget(value: string) {
  haltSpeech();
  result.value = null;
  if (mode.value === "image") {
    void updateConfig({ imageTargetLang: value });
  } else {
    void updateConfig({ targetLang: value });
  }
}

/** 交换源语言与目标语言；源语言为自动检测时不可交换。 */
function swapLanguages() {
  const from = currentSourceLang.value;
  const to = currentTargetLang.value;
  if (from === "auto") return;
  haltSpeech();
  result.value = null;
  if (mode.value === "image") {
    void updateConfig({ imageSourceLang: to, imageTargetLang: from });
  } else {
    void updateConfig({ sourceLang: to, targetLang: from });
  }
}

/** 切换文本/图片翻译；停止朗读并作废尚未完成的文本请求。 */
function switchMode(next: WorkspaceMode) {
  if (mode.value === next) return;
  if (next === "image" && !imageModeAvailable.value) return;
  haltSpeech();
  if (autoTranslateTimer) {
    clearTimeout(autoTranslateTimer);
    autoTranslateTimer = undefined;
  }
  translateSeq++;
  loading.value = false;
  mode.value = next;
}

/** 语言栏上的快捷开关：切换自动方向，开启时立即按当前输入调整语言。 */
function toggleAutoDirection() {
  if (!config.value) return;
  const enabled = !config.value.autoDirection;
  void updateConfig({ autoDirection: enabled });
  if (enabled) applyAutoDirection();
}

/** 执行翻译：递增序号使过期响应被丢弃，完成后按设置自动朗读译文。 */
async function doTranslate() {
  if (mode.value !== "text") return;
  if (!config.value || !text.value.trim()) return;
  const seq = ++translateSeq;
  haltSpeech();
  error.value = "";
  loading.value = true;
  try {
    const response = await translateApi({
      provider: config.value.activeProvider,
      text: text.value,
      from: config.value.sourceLang,
      to: config.value.targetLang,
    });
    if (seq === translateSeq) {
      result.value = response;
      if (config.value.autoSpeak) {
        startSpeaking("result", response.text, config.value.targetLang);
      }
    }
  } catch (e) {
    if (seq === translateSeq) {
      result.value = null;
      error.value = String(e);
    }
  } finally {
    if (seq === translateSeq) loading.value = false;
  }
}

/** 清空输入、译文与错误提示，并停止朗读。 */
function clearSource() {
  haltSpeech();
  text.value = "";
  result.value = null;
  error.value = "";
}

/** 把译文复制到剪贴板，按钮短暂显示"已复制"后恢复。 */
async function copyResult() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.text);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied.value = false), 1600);
  } catch {
    error.value = "复制失败，请手动选择译文复制";
  }
}

/** 打开设置弹窗并清空上次的保存错误。 */
function openSettings() {
  settingsError.value = "";
  settingsOpen.value = true;
}

/**
 * 保存设置：规范化后写入配置；凭据优先存入钥匙串，
 * 钥匙串不可用时自动降级为配置文件明文。
 */
async function handleSettingsSave(
  next: AppConfig,
  nextCredentials: ProviderCredentials,
) {
  try {
    const normalized = normalizeConfig(
      next,
      providers.value,
      imageProviders.value,
    );
    const autoDirectionJustEnabled =
      !config.value?.autoDirection && normalized.autoDirection;
    const saved = await saveSettings(normalized, nextCredentials);
    config.value = saved.config;
    credentials.value = nextCredentials;
    keychainAvailable.value = saved.keychainAvailable;
    // 翻译源被改为非百度时图片翻译不可用，回到文本模式。
    if (mode.value === "image" && !imageModeAvailable.value) {
      mode.value = "text";
    }
    if (autoDirectionJustEnabled) applyAutoDirection();
    result.value = null;
    settingsError.value = "";
    settingsOpen.value = false;
  } catch (e) {
    settingsError.value = String(e);
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="logo">译</div>
        <div class="brand-text">
          <h1>JustTranslator</h1>
          <p>轻量跨平台翻译</p>
        </div>
      </div>

      <nav class="mode-tabs" aria-label="翻译模式">
        <button
          class="mode-tab"
          :class="{ active: mode === 'text' }"
          type="button"
          @click="switchMode('text')"
        >
          文本翻译
        </button>
        <button
          v-if="imageModeAvailable"
          class="mode-tab"
          :class="{ active: mode === 'image' }"
          type="button"
          @click="switchMode('image')"
        >
          图片翻译
        </button>
      </nav>

      <div class="topbar-actions">
        <AppSelect
          v-if="mode === 'text' && providers.length"
          class="provider-select"
          :model-value="config?.activeProvider ?? ''"
          :options="providerOptions"
          label="翻译源"
          align="end"
          @update:model-value="changeProvider"
        />
        <button
          class="icon-btn"
          type="button"
          :title="`主题：${themeLabels[currentTheme]}，点击切换`"
          :aria-label="`切换主题，当前${themeLabels[currentTheme]}`"
          @click="cycleTheme"
        >
          <svg
            v-if="currentTheme === 'light'"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"
            />
          </svg>
          <svg
            v-else-if="currentTheme === 'dark'"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
            />
          </svg>
          <!-- 半明半暗表盘：左半太阳光芒、右半月相填充，示意跟随系统自动切换明暗 -->
          <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" />
            <circle
              cx="12"
              cy="12"
              r="7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
            />
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              d="M12 2.6v1.6M5.4 5.4l1.1 1.1M2.6 12h1.6M5.4 18.6l1.1-1.1M12 19.8v1.6"
            />
          </svg>
        </button>
        <button
          class="icon-btn"
          type="button"
          title="设置"
          aria-label="设置"
          @click="openSettings"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
            />
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.15.62.68 1.08 1.32 1.16H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z"
            />
          </svg>
        </button>
      </div>
    </header>

    <main v-if="!booting && config" class="workspace">
      <div class="lang-bar">
        <AppSelect
          :model-value="currentSourceLang"
          :options="sourceOptions"
          label="源语言"
          @update:model-value="changeSource"
        />

        <button
          class="swap-btn"
          type="button"
          title="交换语言"
          aria-label="交换语言"
          :disabled="currentSourceLang === 'auto'"
          @click="swapLanguages"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 20l3.5-3.5L17 13m3.5 3.5h-13"
            />
          </svg>
        </button>

        <AppSelect
          :model-value="currentTargetLang"
          :options="targetOptions"
          label="目标语言"
          @update:model-value="changeTarget"
        />

        <button
          v-if="mode === 'text'"
          class="auto-direction-btn"
          :class="{ active: config.autoDirection }"
          type="button"
          :aria-pressed="config.autoDirection"
          title="根据输入语言自动切换翻译方向"
          @click="toggleAutoDirection"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
            />
          </svg>
          <span>自动切换</span>
        </button>

        <span class="lang-spacer"></span>
        <span class="provider-hint">{{ currentProvider?.description }}</span>
      </div>

      <div v-if="missingSettings" class="alert">
        <span>
          尚未填写 {{ currentProvider?.name }} 的凭据，翻译暂不可用。
        </span>
        <button type="button" class="link-btn" @click="openSettings">
          去设置
        </button>
        <span
          v-if="currentProvider?.helpLinks?.length"
          class="alert-links"
        >
          <button
            v-for="link in currentProvider.helpLinks"
            :key="link.url"
            type="button"
            class="link-btn"
            @click="openExternalUrl(link.url)"
          >
            {{ link.label }}
          </button>
        </span>
      </div>

      <div v-if="mode === 'text'" class="panes">
        <section class="pane">
          <div class="pane-head">
            <span>原文</span>
            <div class="pane-head-actions">
              <button
                class="speak-btn"
                :class="{ speaking: speaking === 'source' }"
                type="button"
                :disabled="!text.trim()"
                :title="speaking === 'source' ? '停止朗读' : '朗读原文'"
                :aria-label="speaking === 'source' ? '停止朗读' : '朗读原文'"
                @click="toggleSpeak('source')"
              >
                <svg
                  v-if="speaking === 'source'"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  aria-hidden="true"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M11 5 6.5 9H3v6h3.5L11 19V5Z"
                  />
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 9.5a4 4 0 0 1 0 5M17.5 7a8 8 0 0 1 0 10"
                  />
                </svg>
              </button>
            </div>
          </div>
          <textarea
            v-model="text"
            class="source-input"
            placeholder="输入或粘贴要翻译的内容…"
            spellcheck="false"
            autofocus
            @keydown.ctrl.enter.prevent="doTranslate"
            @keydown.meta.enter.prevent="doTranslate"
          ></textarea>
          <div class="pane-foot">
            <button
              class="ghost-btn"
              type="button"
              :disabled="!text"
              @click="clearSource"
            >
              清空
            </button>
            <button
              class="primary-btn"
              type="button"
              :disabled="!canTranslate"
              @click="doTranslate"
            >
              <span v-if="loading" class="spinner" aria-hidden="true"></span>
              {{ loading ? "翻译中" : "翻译" }}
              <kbd v-if="!loading">Ctrl + ↵</kbd>
            </button>
          </div>
        </section>

        <section class="pane">
          <div class="pane-head">
            <span>译文</span>
            <div v-if="result" class="pane-head-actions">
              <button
                class="speak-btn"
                :class="{ speaking: speaking === 'result' }"
                type="button"
                :title="speaking === 'result' ? '停止朗读' : '朗读译文'"
                :aria-label="speaking === 'result' ? '停止朗读' : '朗读译文'"
                @click="toggleSpeak('result')"
              >
                <svg
                  v-if="speaking === 'result'"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  aria-hidden="true"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M11 5 6.5 9H3v6h3.5L11 19V5Z"
                  />
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 9.5a4 4 0 0 1 0 5M17.5 7a8 8 0 0 1 0 10"
                  />
                </svg>
              </button>
              <button
                class="ghost-btn small"
                type="button"
                @click="copyResult"
              >
                {{ copied ? "已复制" : "复制" }}
              </button>
            </div>
          </div>
          <div class="result-body">
            <p v-if="error" class="error-text">{{ error }}</p>
            <p v-else-if="result" class="result-text">{{ result.text }}</p>
            <p v-else class="placeholder">译文会显示在这里</p>
          </div>
        </section>
      </div>

      <ImageTranslator
        v-else
        :provider="activeImageProvider"
        :source-lang="currentSourceLang"
        :target-lang="currentTargetLang"
      />
    </main>

    <main v-else class="workspace booting">
      <div v-if="error" class="error-text">{{ error }}</div>
      <div v-else class="loading-hint">正在加载…</div>
    </main>

    <footer class="footer">
      <span>译文由所选翻译源提供</span>
    </footer>

    <Teleport to="body">
      <SettingsModal
        v-if="settingsOpen && config"
        :providers="providers"
        :image-providers="imageProviders"
        :config="config"
        :credentials="credentials"
        :keychain-available="keychainAvailable"
        :config-path="configPath"
        :error="settingsError"
        @save="handleSettingsSave"
        @close="settingsOpen = false"
      />
    </Teleport>
  </div>
</template>
