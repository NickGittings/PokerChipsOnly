import { native } from './platform';
import { storage } from './storage';
export { parseOrigin, wsUrl } from '../../shared/origin';
// Web is always served by the game server itself; native has to be paired to one (null until then).
export const serverOrigin = () => native ? storage.get('poker-server') : location.origin;
export const setServerOrigin = (origin: string | null) => origin ? storage.set('poker-server', origin) : storage.remove('poker-server');
