import { AsyncLocalStorage } from 'node:async_hooks';
const current=new AsyncLocalStorage();
export const withMailContext=(value,fn)=>current.run(value,fn);
export function mailContext(){const value=current.getStore();if(!value)throw new Error('Mail request context required');return value;}
export const environment=()=>mailContext().env;
