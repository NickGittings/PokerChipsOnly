import { createContext, type RefCallback } from 'react';

// Keep alerts inside the active celebration's modal and keyboard focus scope.
export const AlertHostContext = createContext<RefCallback<HTMLDivElement>>(() => {});
