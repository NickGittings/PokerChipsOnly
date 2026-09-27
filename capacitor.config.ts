import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'com.nickgittings.pokerchipsonly', appName: 'PokerChips Only', webDir: 'dist', ios: { contentInset: 'never', backgroundColor: '#0B2517' }, android: { backgroundColor: '#0B2517' }, server: { androidScheme: 'http' }, plugins: { SystemBars: { initialViewportFitValueHint: 'cover', style: 'DARK' } } };
export default config;
