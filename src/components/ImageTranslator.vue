<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { downloadDir, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { translateImage as translateImageApi } from "../api";
import type {
  ImagePasteMode,
  ImageTranslateResponse,
  ProviderInfo,
} from "../types";

const props = defineProps<{
  provider: ProviderInfo | null;
  sourceLang: string;
  targetLang: string;
}>();

const MAX_BYTES = 5 * 1024 * 1024;

/** 根据运行系统显示对应的粘贴快捷键。 */
const pasteShortcut = /mac/i.test(navigator.userAgent) ? "⌘V" : "Ctrl+V";

const fileInput = ref<HTMLInputElement | null>(null);
const sourceDataUrl = ref("");
const sourceBase64 = ref("");
const sourceName = ref("");
const sourceSize = ref(0);
const dragActive = ref(false);

/** 1 整图贴合，0 仅返回文本。 */
const pasteMode = ref<ImagePasteMode>(1);
const result = ref<ImageTranslateResponse | null>(null);
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const copiedText = ref(false);
const savedPath = ref("");

let copiedTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => window.addEventListener("paste", handlePaste));
onBeforeUnmount(() => {
  window.removeEventListener("paste", handlePaste);
  if (copiedTimer) clearTimeout(copiedTimer);
});

watch(
  () => [props.sourceLang, props.targetLang],
  () => {
    result.value = null;
    error.value = "";
    savedPath.value = "";
  },
);

watch(pasteMode, () => {
  result.value = null;
  error.value = "";
  savedPath.value = "";
});

/** 打开系统文件选择器。 */
function openPicker() {
  fileInput.value?.click();
}

/** 选择文件后统一走本地校验与读取。 */
function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) acceptFile(file);
  (event.target as HTMLInputElement).value = "";
}

/** 拖拽悬停时高亮放置区域。 */
function handleDrop(event: DragEvent) {
  dragActive.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) acceptFile(file);
}

/** 支持直接粘贴剪贴板中的截图或图片。 */
function handlePaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
    return;
  }
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
    entry.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (file) {
    event.preventDefault();
    acceptFile(file);
  }
}

/** 校验图片类型与大小后读取为 data URL，并清空上次结果。 */
function acceptFile(file: File) {
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    error.value = "仅支持 PNG、JPG 格式的图片";
    return;
  }
  if (file.size > MAX_BYTES) {
    error.value = "图片大小不能超过 5 MB";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result ?? "");
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) {
      error.value = "读取图片失败，请重试";
      return;
    }
    sourceDataUrl.value = dataUrl;
    sourceBase64.value = dataUrl.slice(comma + 1);
    sourceName.value = file.name || "剪贴板图片";
    sourceSize.value = file.size;
    result.value = null;
    error.value = "";
    savedPath.value = "";
  };
  reader.onerror = () => {
    error.value = "读取图片失败，请重试";
  };
  reader.readAsDataURL(file);
}

/** 清空已选图片与翻译结果。 */
function clearImage() {
  sourceDataUrl.value = "";
  sourceBase64.value = "";
  sourceName.value = "";
  sourceSize.value = 0;
  result.value = null;
  error.value = "";
  savedPath.value = "";
}

/** 调用图片翻译接口；整图贴合时返回可直接展示的译文图片。 */
async function run() {
  if (!props.provider) {
    error.value = "未找到可用的图片翻译源";
    return;
  }
  if (!sourceBase64.value) {
    error.value = "请先选择要翻译的图片";
    return;
  }

  loading.value = true;
  error.value = "";
  savedPath.value = "";
  result.value = null;
  try {
    result.value = await translateImageApi({
      provider: props.provider.id,
      image: sourceBase64.value,
      from: props.sourceLang,
      to: props.targetLang,
      paste: pasteMode.value,
      viewType: 1,
    });
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

/** 把译文图片保存到系统下载目录；桌面环境不可用时退回浏览器下载。 */
async function saveImage() {
  const dataUrl = result.value?.pasteImage;
  if (!dataUrl) return;

  saving.value = true;
  savedPath.value = "";
  try {
    const { bytes, mime } = decodeDataUrl(dataUrl);
    const ext = mime === "image/jpeg" ? "jpg" : "png";
    const dir = await downloadDir();
    const path = await join(dir, `justtranslator-${Date.now()}.${ext}`);
    await writeFile(path, bytes);
    savedPath.value = `已保存到 ${path}`;
  } catch {
    downloadInBrowser(dataUrl);
    savedPath.value = "已通过浏览器下载译文图片";
  } finally {
    saving.value = false;
  }
}

/** 浏览器预览环境下无法访问系统下载目录时使用。 */
function downloadInBrowser(dataUrl: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `justtranslator-${Date.now()}.png`;
  link.click();
}

/** 把 data URL 解码为字节数组与 MIME 类型。 */
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("无效的图片数据");
  const mime = match[1] || "image/png";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mime };
}

/** 复制译文文本，按钮短暂显示“已复制”。 */
async function copyText() {
  const text = result.value?.dst;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedText.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedText.value = false), 1600);
  } catch {
    error.value = "复制失败，请手动选择译文复制";
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
</script>

<template>
  <div class="panes image-panes">
    <section class="pane">
      <div class="pane-head">
        <span>
          原图
          <span v-if="sourceName" class="image-file-meta">
            {{ sourceName }} · {{ formatSize(sourceSize) }}
          </span>
        </span>
        <div class="pane-head-actions">
          <button class="ghost-btn small" type="button" @click="openPicker">
            选择图片
          </button>
        </div>
      </div>

      <div
        class="image-stage"
        :class="{ dragging: dragActive, empty: !sourceDataUrl }"
        role="button"
        tabindex="0"
        aria-label="选择或拖入要翻译的图片"
        @click="openPicker"
        @keydown.enter.prevent="openPicker"
        @keydown.space.prevent="openPicker"
        @dragover.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInput"
          class="image-file-input"
          type="file"
          accept="image/png,image/jpeg"
          @change="handleFileChange"
        />
        <img
          v-if="sourceDataUrl"
          class="source-image"
          :src="sourceDataUrl"
          alt="待翻译图片"
        />
        <div v-else class="image-drop-hint">
          <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 5.5h16v13H4zM4 14l4.5-4.5L14 15m-1.5-1.5 2.5-2.5L20 15M9 9.2a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Z"
            />
          </svg>
          <p>点击选择图片，或拖拽、粘贴（{{ pasteShortcut }}）截图</p>
          <p class="field-hint">支持 PNG、JPG，最大 5 MB</p>
        </div>
      </div>

      <div class="pane-foot image-foot">
        <button
          class="ghost-btn"
          type="button"
          :disabled="!sourceDataUrl"
          @click.stop="clearImage"
        >
          清空
        </button>
        <div class="segmented" role="group" aria-label="图片贴合方式">
          <button
            type="button"
            :class="{ active: pasteMode === 1 }"
            @click.stop="pasteMode = 1"
          >
            整图贴合
          </button>
          <button
            type="button"
            :class="{ active: pasteMode === 0 }"
            @click.stop="pasteMode = 0"
          >
            仅文本
          </button>
        </div>
        <button
          class="primary-btn"
          type="button"
          :disabled="!sourceBase64 || loading"
          @click.stop="run"
        >
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          {{ loading ? "翻译中" : "翻译" }}
        </button>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head">
        <span>{{ pasteMode === 1 ? "译文图片" : "译文文本" }}</span>
        <div v-if="result" class="pane-head-actions">
          <button
            v-if="result.pasteImage"
            class="ghost-btn small"
            type="button"
            :disabled="saving"
            @click="saveImage"
          >
            {{ saving ? "保存中" : "保存图片" }}
          </button>
          <button
            v-if="result.dst"
            class="ghost-btn small"
            type="button"
            @click="copyText"
          >
            {{ copiedText ? "已复制" : "复制译文" }}
          </button>
        </div>
      </div>

      <div class="image-result">
        <p v-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="loading" class="image-loading">
          <span class="spinner" aria-hidden="true"></span>
          正在识别并翻译图片…
        </div>
        <template v-else-if="result">
          <img
            v-if="result.pasteImage"
            class="result-image"
            :src="result.pasteImage"
            alt="翻译后的图片"
          />
          <div v-if="result.dst" class="result-text-block">
            <p class="result-text">{{ result.dst }}</p>
          </div>
          <p v-if="savedPath" class="field-hint image-saved">{{ savedPath }}</p>
        </template>
        <p v-else class="placeholder">
          选择“整图贴合”模式会返回翻译后的图片，“仅文本”则返回识别与译文。
        </p>
      </div>
    </section>
  </div>
</template>
