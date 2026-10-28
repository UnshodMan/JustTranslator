<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

interface SelectOption {
  value: string;
  label: string;
}

const props = defineProps<{
  modelValue: string;
  options: SelectOption[];
  /** 触发按钮的无障碍名称。 */
  label: string;
  /** 将弹出列表对齐到触发器的右边缘，适用于靠近窗口边界的选择框。 */
  align?: "start" | "end";
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const root = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const dropUp = ref(false);

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? "",
);

/** 切换下拉列表的展开/收起状态。 */
function toggle() {
  if (open.value) {
    closeList();
  } else {
    openList();
  }
}

/** 展开列表：高亮当前选中项，窗口底部空间不足时向上弹出，并监听外部点击。 */
function openList() {
  activeIndex.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  );

  // 弹出列表会超出窗口底部时改为向上弹出。
  const rect = root.value?.getBoundingClientRect();
  const estimatedHeight = Math.min(props.options.length * 38 + 12, 264);
  dropUp.value = rect
    ? rect.bottom + estimatedHeight > window.innerHeight &&
    rect.top > estimatedHeight
    : false;

  open.value = true;
  document.addEventListener("pointerdown", onOutside, true);
  requestAnimationFrame(scrollToActive);
}

/** 收起列表并移除外部点击监听。 */
function closeList() {
  open.value = false;
  document.removeEventListener("pointerdown", onOutside, true);
}

/** 点击组件外部时收起列表。 */
function onOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closeList();
}

/** 选中某项：收起列表，值有变化时通知父组件。 */
function choose(option: SelectOption) {
  closeList();
  if (option.value !== props.modelValue) {
    emit("update:modelValue", option.value);
  }
}

/** 按方向键循环移动高亮项并滚动到可见位置。 */
function move(step: number) {
  const count = props.options.length;
  if (!count) return;
  activeIndex.value = (activeIndex.value + step + count) % count;
  scrollToActive();
}

/** 把当前高亮项滚动到列表可视区域内。 */
function scrollToActive() {
  const item = listEl.value?.children[activeIndex.value] as HTMLElement | undefined;
  item?.scrollIntoView({ block: "nearest" });
}

/** 键盘操作：回车/空格选择，Esc 关闭，方向键与 Home/End 移动高亮，Tab 直接收起。 */
function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case "Enter":
    case " ":
      event.preventDefault();
      if (open.value) {
        const option = props.options[activeIndex.value];
        if (option) choose(option);
      } else {
        openList();
      }
      break;
    case "Escape":
      if (open.value) {
        event.stopPropagation();
        closeList();
      }
      break;
    case "ArrowDown":
      event.preventDefault();
      if (open.value) {
        move(1);
      } else {
        openList();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (open.value) {
        move(-1);
      } else {
        openList();
      }
      break;
    case "Home":
      if (open.value) {
        event.preventDefault();
        activeIndex.value = 0;
        scrollToActive();
      }
      break;
    case "End":
      if (open.value) {
        event.preventDefault();
        activeIndex.value = props.options.length - 1;
        scrollToActive();
      }
      break;
    case "Tab":
      closeList();
      break;
  }
}

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onOutside, true);
});
</script>

<template>
  <div ref="root" class="app-select" :class="{ 'is-open': open }">
    <button type="button" class="app-select-trigger" role="combobox" :aria-label="label" :aria-expanded="open"
      aria-haspopup="listbox" @click="toggle" @keydown="onKeydown">
      <span class="app-select-value">{{ selectedLabel }}</span>
      <svg class="app-select-chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <ul v-if="open" ref="listEl" class="app-select-list" :class="{ 'drop-up': dropUp, 'align-end': align === 'end' }"
      role="listbox">
      <li v-for="(option, index) in options" :key="option.value" class="app-select-option" role="option"
        :aria-selected="option.value === modelValue" :class="{
          'is-active': index === activeIndex,
          'is-selected': option.value === modelValue,
        }" @pointerenter="activeIndex = index" @click="choose(option)">
        <span>{{ option.label }}</span>
        <svg v-if="option.value === modelValue" class="app-select-check" viewBox="0 0 24 24" width="14" height="14"
          aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
            d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      </li>
    </ul>
  </div>
</template>
