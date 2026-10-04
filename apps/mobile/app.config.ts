import type { ConfigContext, ExpoConfig } from 'expo/config';

// Permanent store identifiers (see "Identifiers" in docs/specs/auth.md). Don't change after release.
const appId = 'ai.faraj.nexui';

// Reversed iOS OAuth client ID. Local builds read it from .env; EAS builds need it as an EAS
// environment variable because .env isn't uploaded.
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();

// Google Maps key for Android builds (optional). Without one, Android shows the route as a list.
// iOS uses Apple Maps, which needs no key.
const googleMapsAndroidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();

if (!googleIosUrlScheme) {
  const message =
    'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is not set, so iOS builds cannot use Google sign-in.';

  if (process.env.EAS_BUILD_PLATFORM === 'ios') {
    throw new Error(message);
  }

  if (process.env.EAS_BUILD !== 'true') {
    console.warn(`[app.config] ${message}`);
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'nexui',
  slug: 'nexui',
  owner: 'farajsiddiques-team',
  version: '1.0.0',
  scheme: 'nexui',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: appId,
    usesAppleSignIn: true,
  },
  android: {
    package: appId,
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-image',
    'expo-secure-store',
    'expo-apple-authentication',
    [
      'react-native-maps',
      googleMapsAndroidKey ? { androidGoogleMapsApiKey: googleMapsAndroidKey } : {},
    ] satisfies [string, unknown],
    ...(googleIosUrlScheme
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: googleIosUrlScheme },
          ] satisfies [string, unknown],
        ]
      : []),
    // Required to launch on iOS 27; see the plugin for when to remove it.
    './plugins/with-scene-lifecycle.js',
  ],
  experiments: {
    typedRoutes: true,
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  extra: {
    router: {},
    mapsOnAndroid: Boolean(googleMapsAndroidKey),
    eas: {
      projectId: '2a0da270-390a-4e11-874f-6fa3a7f85d68',
    },
  },
});
