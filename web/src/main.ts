import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './styles.css';
import App from './App.vue';
import { initBridge } from './net/bridge';

const app = createApp(App);
app.use(createPinia());
app.use(ElementPlus);
initBridge();
app.mount('#app');
