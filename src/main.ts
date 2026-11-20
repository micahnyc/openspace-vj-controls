import { mount } from 'svelte';
// Fonts are bundled with the app (no third-party requests): only the weights and Latin subset Neon Flat uses.
import '@fontsource/barlow/latin-400';
import '@fontsource/barlow-condensed/latin-600';
import '@fontsource/barlow-condensed/latin-700';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/jetbrains-mono/latin-500';
import '@fontsource/jetbrains-mono/latin-700';
import './styles/neon-flat.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
