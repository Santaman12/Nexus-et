import { registerFileTools } from './files.js';
import { registerPcTools } from './pc.js';
import { registerSystemTools } from './system.js';

let registered = false;

export function registerAllTools(): void {
  if (registered) return;
  registered = true;
  registerSystemTools();
  registerPcTools();
  registerFileTools();
}
