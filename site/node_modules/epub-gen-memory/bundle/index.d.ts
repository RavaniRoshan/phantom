/// <reference types="DOM" />
import { Content, Options } from '../dist/lib';
export * from '../dist/lib';

declare const epub: (optionsOrTitle: Options | string, content: Content, ...args: (boolean | number)[]) => Promise<Blob>;
export default epub;
