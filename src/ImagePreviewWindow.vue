<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 与主窗口通过 localStorage 共享图片数据，键名需与 ImageTranslator 一致。 */
const PREVIEW_STORAGE_KEY = "justtranslator-preview-image";

const src = ref("");
const scale = ref(1);
const x = ref(0);
const y = ref(0);
const dragging = ref(false);

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

const imgStyle = computed(() => ({
  transform: `translate(${x.value}px, ${y.value}px) scale(${scale.value})`,
}));

let drag: {
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
} | null = null;
let moved = false;
let suppressClick = false;
let unlistenReload: (() => void) | undefined;

onMounted(async () => {
  src.value = localStorage.getItem(PREVIEW_STORAGE_KEY) ?? "";
  window.addEventListener("keydown", handleKeydown);
  try {
    // 主窗口再次点击图片时，更新本窗口图片并聚焦。
    unlistenReload = await listen<string>("preview-reload", (event) => {
      resetView(event.payload);
    });
  } catch {
    // 浏览器预览模式下没有 Tauri 事件，跳过。
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("mousemove", handleDragMove);
  window.removeEventListener("mouseup", handleDragEnd);
  unlistenReload?.();
});

function resetView(next: string) {
  src.value = next;
  scale.value = 1;
  x.value = 0;
  y.value = 0;
}

/** 关闭预览窗口；浏览器模式下仅脚本打开的窗口可关闭。 */
async function closeWindow() {
  try {
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") void closeWindow();
}

/** 拖拽刚结束时要抑制紧随其后的 click，避免误关闭窗口。 */
function handleClick() {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  void closeWindow();
}

/** 滚轮缩放，以光标所在位置为锚点。 */
function handleWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const px = event.clientX - (rect.left + rect.width / 2);
  const py = event.clientY - (rect.top + rect.height / 2);
  const next = clampNumber(
    scale.value * Math.exp(-event.deltaY * 0.0016),
    MIN_SCALE,
    MAX_SCALE,
  );
  const ratio = next / scale.value;
  x.value = px - (px - x.value) * ratio;
  y.value = py - (py - y.value) * ratio;
  scale.value = next;
}

/** 左键按下开始拖拽平移。 */
function startDrag(event: MouseEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  drag = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    originX: x.value,
    originY: y.value,
  };
  moved = false;
  dragging.value = true;
  window.addEventListener("mousemove", handleDragMove);
  window.addEventListener("mouseup", handleDragEnd);
}

function handleDragMove(event: MouseEvent) {
  if (!drag) return;
  const dx = event.clientX - drag.pointerX;
  const dy = event.clientY - drag.pointerY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
  x.value = drag.originX + dx;
  y.value = drag.originY + dy;
}

function handleDragEnd() {
  drag = null;
  dragging.value = false;
  suppressClick = moved;
  window.removeEventListener("mousemove", handleDragMove);
  window.removeEventListener("mouseup", handleDragEnd);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
</script>

<template>
  <div
    class="preview-window"
    :class="{ dragging }"
    @click="handleClick"
    @mousedown="startDrag"
    @wheel.prevent="handleWheel"
  >
    <img
      v-if="src"
      class="preview-window-img"
      :src="src"
      :style="imgStyle"
      alt="图片放大预览"
      draggable="false"
    />
    <p v-else class="preview-window-empty">暂无预览图片</p>
    <p v-if="src" class="preview-window-hint">
      滚轮缩放 · 左键拖拽移动 · 点击空白处或按 Esc 关闭窗口
    </p>
  </div>
</template>
