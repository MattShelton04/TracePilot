import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

// Apply persisted theme before mount to prevent flash
const savedTheme = localStorage.getItem("tracepilot-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#root");
