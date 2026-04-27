const BASE = import.meta.env.VITE_API_BASE;

if (!BASE) {
  throw new Error("VITE_API_BASE is not defined in production");
}

export const API_BASE = BASE;