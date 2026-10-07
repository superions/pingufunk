import { AsyncLocalStorage } from "node:async_hooks";
import type { WritableSettingKey } from "./settings-schema";

export type ProductSettingsSnapshot = {
  values: Readonly<Record<WritableSettingKey, string>>;
  isCurrent: () => boolean;
};
export const productSettingsContext = new AsyncLocalStorage<ProductSettingsSnapshot>();
