<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppSelect from "./AppSelect.vue";
import { openExternalUrl } from "../services/external-links";
import type {
  AppConfig,
  ProviderCredentials,
  ProviderInfo,
  SpeechEngine,
} from "../types";

const props = defineProps<{
  providers: ProviderInfo[];
  imageProviders: ProviderInfo[];
  config: AppConfig;
  credentials: ProviderCredentials;
  /** 系统钥匙串是否可用；不可用时凭据会明文写入配置文件。 */
  keychainAvailable: boolean;
  configPath: string;
  error?: string;
}>();

const emit = defineEmits<{
  (e: "save", config: AppConfig, credentials: ProviderCredentials): void;
  (e: "close"): void;
}>();

const draft = ref<AppConfig>(JSON.parse(JSON.stringify(props.config)));
const draftCredentials = ref<ProviderCredentials>(
  JSON.parse(JSON.stringify(props.credentials)),
);

for (const provider of [...props.providers, ...props.imageProviders]) {
  if (!draftCredentials.value[provider.id]) {
    draftCredentials.value[provider.id] = {};
  }
  for (const field of provider.fields) {
    if (draftCredentials.value[provider.id][field.key] == null) {
      draftCredentials.value[provider.id][field.key] = "";
    }
  }
}

const selectedProvider = computed(
  () => props.providers.find((p) => p.id === draft.value.activeProvider) ?? null,
);

/**
 * 图片翻译目前仅接入百度，且与百度文本翻译共用凭据，
 * 因此只在翻译源选择百度翻译时展示图片翻译的凭据配置。
 */
const showImageSection = computed(
  () =>
    props.imageProviders.length > 0 && draft.value.activeProvider === "baidu",
);

const speechEngineOptions: { value: SpeechEngine; label: string }[] = [
  { value: "auto", label: "自动（系统优先，无音色时在线）" },
  { value: "system", label: "系统语音（离线）" },
  { value: "online", label: "在线语音（Google）" },
];

/** 更新草稿中的朗读引擎选择。 */
function changeSpeechEngine(value: string) {
  draft.value.speechEngine = value as SpeechEngine;
}

/** 按下 Esc 时关闭弹窗。 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", handleKeydown, true));
onBeforeUnmount(() =>
  document.removeEventListener("keydown", handleKeydown, true),
);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="设置">
      <div class="dialog-head">
        <div>
          <h2>设置</h2>
          <p class="dialog-sub">选择翻译源并填写对应凭据</p>
        </div>
        <button class="icon-btn" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <section class="section">
          <h3 class="section-title">翻译源</h3>
          <div class="provider-cards">
            <button v-for="provider in providers" :key="provider.id" type="button" class="provider-card"
              :class="{ active: draft.activeProvider === provider.id }" @click="draft.activeProvider = provider.id">
              <span class="provider-name">
                {{ provider.name }}
                <span v-if="draft.activeProvider === provider.id" class="badge">
                  当前
                </span>
              </span>
              <span class="provider-desc">{{ provider.description }}</span>
            </button>
          </div>
        </section>

        <section v-if="selectedProvider" class="section">
          <h3 class="section-title">{{ selectedProvider.name }} 凭据</h3>

          <div v-if="selectedProvider.fields.length === 0" class="empty-hint">
            该翻译源无需填写凭据。
          </div>

          <div v-for="field in selectedProvider.fields" :key="field.key" class="field">
            <label :for="`${selectedProvider.id}-${field.key}`">
              {{ field.label }}
            </label>
            <input :id="`${selectedProvider.id}-${field.key}`"
              v-model="draftCredentials[selectedProvider.id][field.key]" :type="field.secret ? 'password' : 'text'"
              :placeholder="field.placeholder" autocomplete="off" spellcheck="false" />
          </div>

          <p v-if="selectedProvider.helpLinks?.length" class="help-links">
            <span>申请与文档：</span>
            <button v-for="link in selectedProvider.helpLinks" :key="link.url" type="button" class="link-btn"
              @click="openExternalUrl(link.url)">
              {{ link.label }}
            </button>
          </p>
        </section>

        <section v-if="showImageSection" class="section">
          <h3 class="section-title">图片翻译凭据</h3>
          <div v-for="provider in imageProviders" :key="provider.id" class="image-provider">

            <div v-for="field in provider.fields" :key="field.key" class="field">
              <label :for="`${provider.id}-${field.key}`">
                {{ field.label }}
              </label>
              <input :id="`${provider.id}-${field.key}`" v-model="draftCredentials[provider.id][field.key]"
                :type="field.secret ? 'password' : 'text'" :placeholder="field.placeholder" autocomplete="off"
                spellcheck="false" />
            </div>
            <p class="field-hint image-provider-desc">
              {{ provider.description }}
            </p>
            <p v-if="provider.helpLinks?.length" class="help-links">
              <span>申请与文档：</span>
              <button v-for="link in provider.helpLinks" :key="link.url" type="button" class="link-btn"
                @click="openExternalUrl(link.url)">
                {{ link.label }}
              </button>
            </p>
          </div>
        </section>

        <section class="section">
          <h3 class="section-title">自动翻译</h3>
          <div class="toggle-row">
            <div class="toggle-copy">
              <span class="toggle-label">停止输入后自动翻译</span>
              <p class="field-hint">
                输入暂停后自动调用翻译接口，无需手动点击翻译按钮。
              </p>
            </div>
            <label class="switch">
              <input v-model="draft.autoTranslate" type="checkbox" />
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
        </section>

        <section class="section">
          <h3 class="section-title">自动切换翻译目标</h3>
          <div class="toggle-row">
            <div class="toggle-copy">
              <span class="toggle-label">根据输入语言自动切换翻译语言</span>
              <p class="field-hint">
                输入中文时目标语言自动设为英语，输入英语时自动设为中文；
                其他语言则把源语言设为"自动检测"，由翻译源识别。
              </p>
            </div>
            <label class="switch">
              <input v-model="draft.autoDirection" type="checkbox" />
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
        </section>

        <section class="section">
          <h3 class="section-title">朗读</h3>
          <div class="toggle-row">
            <div class="toggle-copy">
              <span class="toggle-label">朗读引擎</span>
              <p class="field-hint">
                自动模式优先使用系统语音；系统没有对应语言的音色时改用
                Google 在线语音（需要联网）。
              </p>
            </div>
            <AppSelect class="speech-engine-select" :model-value="draft.speechEngine" :options="speechEngineOptions"
              label="朗读引擎" align="end" @update:model-value="changeSpeechEngine" />
          </div>

          <div class="field">
            <label for="speech-rate">
              语速：{{ draft.speechRate.toFixed(1) }}x
            </label>
            <input id="speech-rate" v-model.number="draft.speechRate" type="range" min="0.6" max="1.4" step="0.1" />
            <p class="field-hint">仅对系统语音生效，在线语音固定为正常语速。</p>
          </div>

          <div class="toggle-row">
            <div class="toggle-copy">
              <span class="toggle-label">译文完成后自动朗读</span>
              <p class="field-hint">
                每次翻译完成后自动朗读译文；播放中点击喇叭按钮可随时停止。
              </p>
            </div>
            <label class="switch">
              <input v-model="draft.autoSpeak" type="checkbox" />
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
        </section>

        <p v-if="error" class="record-error dialog-error">{{ error }}</p>

        <p class="footnote">
          <template v-if="keychainAvailable">
            凭据保存在系统钥匙串中；配置文件仅保存其他设置<span v-if="configPath">：{{ configPath }}</span>
          </template>
          <template v-else>
            系统钥匙串不可用，凭据将以明文保存在配置文件中<span v-if="configPath">：{{ configPath }}</span>
          </template>
        </p>
      </div>

      <div class="dialog-foot">
        <button class="ghost-btn" type="button" @click="emit('close')">
          取消
        </button>
        <button class="primary-btn" type="button" @click="emit('save', draft, draftCredentials)">
          保存设置
        </button>
      </div>
    </div>
  </div>
</template>
