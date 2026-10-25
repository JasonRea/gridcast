/* eslint-disable @typescript-eslint/no-require-imports */
// Metro config for the Gridcast iOS app inside the pnpm monorepo.
// Expo detects the monorepo (watch folders, node_modules lookup) on its own. Two additions:
//  1. `@web/*` points at apps/web/src, so the app reuses the web's platform-free modules
//     (field math, store, format helpers) instead of copying them. See DECISIONS.md.
//  2. Shared runtime packages always resolve to this app's copies. Without it, apps/web/src
//     files would pull apps/web's own react / zustand install, and two Reacts crash hooks.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const webSrc = path.resolve(projectRoot, '../web/src');
const config = getDefaultConfig(projectRoot);

const SINGLETONS = ['react', 'react-native', 'zustand', 'zod', '@gridcast/types'];
const isSingleton = (name) => SINGLETONS.some((pkg) => name === pkg || name.startsWith(`${pkg}/`));

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith('@web/')) {
    return resolve(context, path.join(webSrc, moduleName.slice('@web/'.length)), platform);
  }
  if (isSingleton(moduleName)) {
    return resolve(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
