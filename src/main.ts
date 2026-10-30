import { createApp } from "vue";
import App from "./App.vue";
import ImagePreviewWindow from "./ImagePreviewWindow.vue";
import "./style.css";

/** 图片预览窗口与主窗口共用同一入口页面，通过 URL 的 ?preview 参数区分。 */
const isPreviewWindow = new URLSearchParams(window.location.search).has(
  "preview",
);

createApp(isPreviewWindow ? ImagePreviewWindow : App).mount("#app");
