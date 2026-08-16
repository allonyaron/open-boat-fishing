const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Packages that register native view managers or have module-level singleton state
// must resolve to exactly one copy in the bundle, regardless of which package
// in the pnpm virtual store is doing the require.
//
// pnpm's non-flat node_modules means @react-navigation/* (inside the pnpm store)
// gets its own copy of react-native-safe-area-context resolved from its subtree,
// while the app itself gets the version we explicitly installed. Metro sees both
// as distinct modules and includes both — causing "Tried to register two views
// with the same name RNCSafeAreaProvider" at startup.
const singletons = new Set([
  "react",
  "react-native",
  "react-native-safe-area-context",
  "react-native-screens",
  "react-native-gesture-handler",
  "react-native-reanimated",
]);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletons.has(moduleName)) {
    const pinnedPath = path.resolve(projectRoot, "node_modules", moduleName);
    return (originalResolveRequest ?? context.resolveRequest)(
      { ...context, originModulePath: pinnedPath + "/package.json" },
      moduleName,
      platform,
    );
  }
  return (originalResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
