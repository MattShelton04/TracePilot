import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

// Apply persisted theme before mount to prevent flash
const saved = localStorage.getItem("tracepilot-prefs");
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    const theme = (parsed.theme === 'dark' || parsed.theme === 'light') ? parsed.theme : 'dark';
    document.documentElement.setAttribute("data-theme", theme);
  } catch { /* ignore corrupt data */ }
} else {
  document.documentElement.setAttribute("data-theme", "dark");
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#root");
