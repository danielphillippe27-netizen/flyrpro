const MAP_PRODUCTS = new Set(['stormcells', 'lightning-flash', 'lightning-strikes', 'lightning-all']);
const VECTOR_PRODUCTS = new Set(['hail-threats-nowcast', 'lightning-threat-zones']);
export function resolveGLRequest(path: string[], method: string) {
  const name = path.join('/');
  if (name === 'auth/token' && method === 'POST') return { kind: 'auth' as const, upstream: name };
  if (name === 'tile' && method === 'GET') return { kind: 'metadata' as const, upstream: name };
  if (/^tile\/\d{1,2}\/\d+\/\d+\/\d+x\d+\/[^/]+\.png$/.test(name) && method === 'POST') return { kind: 'image' as const, upstream: name };
  if (name === 'vector' && method === 'GET') return { kind: 'vectorMetadata' as const, upstream: 'vector/' };
  if (method === 'GET' && path.length === 6 && path[0] === 'vector' && VECTOR_PRODUCTS.has(path[1]) && /^[\dT:Z.+-]+$/.test(path[2]) && /^\d{1,2}$/.test(path[3]) && /^\d+$/.test(path[4]) && /^\d+\.pbf$/.test(path[5])) return { kind: 'vector' as const, upstream: name };
  if (method === 'GET' && path[0] === 'maps' && path[1] === 'wolfgrid_session') {
    if (path.length === 3 && path[2].endsWith('.json') && MAP_PRODUCTS.has(path[2].slice(0,-5))) return { kind: 'maps' as const, upstream: path.slice(2).join('/') };
    if (path.length === 7 && MAP_PRODUCTS.has(path[2]) && path.slice(3,6).every((value) => /^\d+$/.test(value)) && /^(\d{14}|now)\.pbf$/.test(path[6])) return { kind: 'maps' as const, upstream: path.slice(2).join('/') };
  }
  return null;
}
export function allowedVectorProducts(products: string[]) {
  return products.length > 0 && products.length <= 2 && products.every((product) => VECTOR_PRODUCTS.has(product));
}
