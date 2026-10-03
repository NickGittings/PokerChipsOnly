import { Capacitor } from '@capacitor/core';
export const native = Capacitor.isNativePlatform();
// Registered only by debug native builds (Xcode Debug config / debuggable APK), so release apps never show debug tools even if bundled with a build:debug web build.
export const nativeDebug = native && Capacitor.isPluginAvailable('DebugBuild');
