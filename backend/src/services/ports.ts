/**
 * Process-wide PortAllocator singleton.
 *
 * The allocator needs the store, which only exists after initStore(), so it
 * cannot be constructed at module load time — hence the lazy accessor. Callers
 * must use this rather than `new PortAllocator(...)`: a second allocator would
 * have its own reservation set and hand out ports already in use.
 */
import { config } from '../config';
import { getStore } from '../db/store';
import { PortAllocator } from './port-allocator';

let allocator: PortAllocator | null = null;

export function getPortAllocator(): PortAllocator {
  if (!allocator) {
    allocator = new PortAllocator(
      { vnc: { start: config.ports.vnc.start, end: config.ports.vnc.end }, ws: { start: config.ports.ws.start, end: config.ports.ws.end } },
      getStore(),
    );
  }
  return allocator;
}
