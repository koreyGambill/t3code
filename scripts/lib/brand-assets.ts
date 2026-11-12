export const BRAND_ASSET_PATHS = {
  developmentIconComposerProject: "assets/weavewing/app-icon.icon",
  developmentIosIconPng: "assets/weavewing/icon.png",
  developmentUniversalIconPng: "assets/weavewing/icon.png",

  productionIconComposerProject: "assets/weavewing/app-icon.icon",
  productionIosIconPng: "assets/weavewing/icon.png",
  productionMacIconPng: "assets/weavewing/icon.png",
  productionLinuxIconPng: "assets/weavewing/icon.png",
  productionWindowsIconIco: "assets/weavewing/icon.ico",
  productionWebFaviconIco: "assets/weavewing/icon.ico",
  productionWebFavicon16Png: "assets/weavewing/favicon-16.png",
  productionWebFavicon32Png: "assets/weavewing/favicon-32.png",
  productionWebAppleTouchIconPng: "assets/weavewing/apple-touch-icon.png",

  nightlyIconComposerProject: "assets/weavewing/app-icon.icon",
  nightlyIosIconPng: "assets/weavewing/icon.png",
  nightlyMacIconPng: "assets/weavewing/icon.png",
  nightlyLinuxIconPng: "assets/weavewing/icon.png",
  nightlyWindowsIconIco: "assets/weavewing/icon.ico",
  nightlyWebFaviconIco: "assets/weavewing/icon.ico",
  nightlyWebFavicon16Png: "assets/weavewing/favicon-16.png",
  nightlyWebFavicon32Png: "assets/weavewing/favicon-32.png",
  nightlyWebAppleTouchIconPng: "assets/weavewing/apple-touch-icon.png",

  developmentDesktopIconPng: "assets/weavewing/icon.png",
  developmentWindowsIconIco: "assets/weavewing/icon.ico",
  developmentWebFaviconIco: "assets/weavewing/icon.ico",
  developmentWebFavicon16Png: "assets/weavewing/favicon-16.png",
  developmentWebFavicon32Png: "assets/weavewing/favicon-32.png",
  developmentWebAppleTouchIconPng: "assets/weavewing/apple-touch-icon.png",

  productionWebIcon192Png: "assets/weavewing/icon.png",
  productionWebIcon512Png: "assets/weavewing/icon.png",
  nightlyWebIcon192Png: "assets/weavewing/icon.png",
  nightlyWebIcon512Png: "assets/weavewing/icon.png",
  developmentWebIcon192Png: "assets/weavewing/icon.png",
  developmentWebIcon512Png: "assets/weavewing/icon.png",
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
  icon192Png: "icon-192x192.png",
  icon512Png: "icon-512x512.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.developmentWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.developmentWebIcon512Png,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.productionWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.productionWebIcon512Png,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
    {
      sourceRelativePath: sourcePaths.icon192Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.icon192Png}`,
    },
    {
      sourceRelativePath: sourcePaths.icon512Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.icon512Png}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");

export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = resolveWebIconOverrides(
  "development",
  "apps/web/public",
);
