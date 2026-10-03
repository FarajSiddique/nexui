const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

/**
 * Adopts the UIScene life cycle, which apps built with the iOS 27 SDK must use to launch.
 *
 * Expo 57 ships `ExpoAppSceneDelegate`, but its app template still starts React Native from the
 * app delegate. This plugin declares the scene manifest and lets the scene delegate create the
 * window instead. Remove it once the Expo template adopts scenes itself.
 *
 * Expo loads local plugins as plain CommonJS, so this file isn't TypeScript.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };

    return plistConfig;
  });

  return withAppDelegate(config, (delegateConfig) => {
    delegateConfig.modResults.contents = adoptSceneDelegate(delegateConfig.modResults.contents);

    return delegateConfig;
  });
};

const appDelegateDeclaration = 'class AppDelegate: ExpoAppDelegate {';
const providerDeclaration = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

// The template's window setup; the scene delegate creates the window and starts React Native.
const appDelegateWindowStart =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([^)]*\)\n#endif\n/;

/**
 * Makes the Swift app delegate a factory provider that no longer creates its own window.
 *
 * @param {string} contents AppDelegate.swift from the Expo template.
 * @returns {string}
 */
function adoptSceneDelegate(contents) {
  if (contents.includes(providerDeclaration)) {
    return contents;
  }

  if (!contents.includes(appDelegateDeclaration) || !appDelegateWindowStart.test(contents)) {
    throw new Error(
      'with-scene-lifecycle: AppDelegate.swift no longer matches the Expo template. ' +
        'Check whether Expo now adopts scenes itself, and update or remove this plugin.',
    );
  }

  return contents
    .replace(appDelegateDeclaration, providerDeclaration)
    .replace(appDelegateWindowStart, '');
}

module.exports = withSceneLifecycle;
