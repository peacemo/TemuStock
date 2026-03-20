import path from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const generatedIconsDir = path.resolve(__dirname, 'assets/icons/generated');
const packagerIconBase = path.join(generatedIconsDir, 'app-icon');
const linuxIconPath = path.join(generatedIconsDir, 'png/512x512.png');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: packagerIconBase,
    extraResource: [generatedIconsDir],
    ignore: (file: string) => {
      if (!file) {
        return false;
      }

      return !file.startsWith('/.vite') && !file.startsWith('/node_modules');
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: `${packagerIconBase}.ico`,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: linuxIconPath,
      },
    }),
    new MakerDeb({
      options: {
        icon: linuxIconPath,
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
