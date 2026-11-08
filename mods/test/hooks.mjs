// Points the mods' bare imports at the stubs and gives every mount a fresh module graph.

const STUBS = new Set(["gpui-kit", "gpui-base", "herdr"]);

export async function resolve(specifier, context, nextResolve) {
  if (STUBS.has(specifier)) return { url: new URL(`./stubs/${specifier}.mjs`, import.meta.url).href, shortCircuit: true };
  const query = context.parentURL?.split("?")[1];
  if (specifier.startsWith("./") && query && context.parentURL.includes("/hws-")) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, url: `${resolved.url}?${query}` };
  }
  return nextResolve(specifier, context);
}
