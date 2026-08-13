import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * The desktop client ships two build targets: the Electron main process
 * (`src/main`) and its preload bridge (`src/preload`). There is no renderer
 * bundle: the window loads the dsh web profile's own served dist over
 * loopback HTTP, exactly as the browser UI does.
 *
 * Workspace packages stay external: the harness packages resolve through
 * node_modules at runtime, so the electron app never re-bundles the plugin
 * tree. The preload must stay a CommonJS artifact on every target, which is
 * electron-vite's default for preload inputs.
 * @module @deepseek-ai/dsh-electron/vite
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
})
