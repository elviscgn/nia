import { invoke } from "@tauri-apps/api/core";

export type ModelSettings = {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  source: string;
};

export type ModelConnectionResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  model: string;
};

export const modelSettingsGet = () =>
  invoke<ModelSettings>("model_settings_get");

export const modelSettingsSave = (baseUrl: string, model: string, apiKey?: string | null) =>
  invoke<ModelSettings>("model_settings_save", {
    input: { baseUrl, model, apiKey: apiKey ?? null },
  });

export const modelTestConnection = () =>
  invoke<ModelConnectionResult>("model_test_connection");
