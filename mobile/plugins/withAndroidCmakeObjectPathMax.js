const { withAppBuildGradle } = require('@expo/config-plugins');

const CMAKE_ARGUMENT = '-DCMAKE_OBJECT_PATH_MAX=240';

/**
 * React Native's new-architecture codegen mirrors absolute source paths into
 * CMake object names. On Windows those paths can exceed the 260-character
 * MAX_PATH limit and Ninja fails before compiling. CMAKE_OBJECT_PATH_MAX makes
 * CMake shorten the object paths with a deterministic hash.
 */
module.exports = function withAndroidCmakeObjectPathMax(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'withAndroidCmakeObjectPathMax only supports Groovy build.gradle files'
      );
    }

    if (config.modResults.contents.includes('CMAKE_OBJECT_PATH_MAX')) {
      return config;
    }

    const defaultConfig = /(defaultConfig\s*\{)/;
    if (!defaultConfig.test(config.modResults.contents)) {
      throw new Error(
        'withAndroidCmakeObjectPathMax could not find defaultConfig in app/build.gradle'
      );
    }

    config.modResults.contents = config.modResults.contents.replace(
      defaultConfig,
      `$1
        externalNativeBuild {
            cmake {
                arguments "${CMAKE_ARGUMENT}"
            }
        }`
    );

    return config;
  });
};
