/** Insert between the endpoints of the nearest boundary segment, including last → first. */
export function boundaryInsertionIndex(point: readonly number[], vertices: readonly (readonly number[])[]): number {
  if (vertices.length < 3) return vertices.length;
  const scale = Math.cos(point[1] * Math.PI / 180);
  let nearest = Infinity;
  let index = vertices.length;
  for (let i = 0; i < vertices.length; i++) {
    const a = [(vertices[i][0] - point[0]) * scale, vertices[i][1] - point[1]];
    const next = vertices[(i + 1) % vertices.length];
    const b = [(next[0] - point[0]) * scale, next[1] - point[1]];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared)) : 0;
    const distance = (a[0] + t * dx) ** 2 + (a[1] + t * dy) ** 2;
    if (distance < nearest) { nearest = distance; index = i + 1; }
  }
  return index;
}
