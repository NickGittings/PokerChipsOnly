import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { native } from './platform';
export type Haptic = 'turn' | 'bust' | 'win';
// navigator.vibrate is a no-op in WKWebView, so native maps the same intents onto the Taptic Engine.
export function haptic(kind: Haptic) {
  try {
    if (native) void (kind === 'turn' ? Haptics.impact({ style: ImpactStyle.Light }) : Haptics.notification({ type: kind === 'bust' ? NotificationType.Warning : NotificationType.Success })).catch(() => {});
    else navigator.vibrate?.(kind === 'bust' ? [150, 70, 150] : [80, 50, 80]);
  } catch { /* Vibration is optional. */ }
}
