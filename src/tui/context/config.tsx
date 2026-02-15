/**
 * Config context for app-wide configuration access
 */

import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { loadConfig, getConfig, type AppConfig } from "@/core/config"

export interface ConfigContext {
  config: () => AppConfig
  reload: () => Promise<void>
}

export const { provider: ConfigProvider, use: useConfig } = createSimpleContext<ConfigContext>({
  name: "Config",
  init: () => {
    const [config, setConfig] = createSignal<AppConfig>(getConfig())

    const reload = async () => {
      const newConfig = await loadConfig()
      setConfig(newConfig)
    }

    return {
      config,
      reload
    }
  }
})
