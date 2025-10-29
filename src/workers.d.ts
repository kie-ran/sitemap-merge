/**
 * Type declarations for Cloudflare Workers globals
 * 
 * Note: Once @cloudflare/workers-types is installed via npm install,
 * these types will be provided by that package. This file ensures
 * TypeScript doesn't error before the package is installed.
 */

/// <reference types="@cloudflare/workers-types" />

// The @cloudflare/workers-types package provides all necessary type definitions
// for global APIs like TextEncoder, crypto, console, DOMParser, etc.
// These are available at runtime in Cloudflare Workers, and the types package
// provides the TypeScript definitions once installed.

declare global {
  const DOMParser: {
    new (): {
      parseFromString(source: string, mimeType: string): Document;
    };
  };
}

export {};

