import {seconds} from './state';
export const useElapsedSeconds=(active:boolean)=>active?Math.floor(seconds):undefined;
