import { z } from 'zod';
// Compile-free validation supports the same strict CSP in the page and Worker.
z.config({ jitless: true });
export { z };
