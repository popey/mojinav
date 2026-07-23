// Decode a Google-encoded polyline into [lng, lat] pairs.
// 2D only — ORS foot-walking does not return elevation.
export function decodePolyline(polyline: string): number[][] {
  const points: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readDelta = (): number => {
    let result = 0;
    let shift = 0;

    while (true) {
      if (index >= polyline.length) {
        throw new Error("Invalid encoded polyline: truncated coordinate");
      }

      const value = polyline.charCodeAt(index++) - 63;
      if (value < 0 || value > 0x3f) {
        throw new Error("Invalid encoded polyline: invalid character");
      }

      result |= (value & 0x1f) << shift;
      if (value < 0x20) break;

      shift += 5;
      if (shift > 30) {
        throw new Error("Invalid encoded polyline: coordinate overflow");
      }
    }

    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < polyline.length) {
    lat += readDelta();
    lng += readDelta();
    points.push([lng / 1e5, lat / 1e5]);
  }

  return points;
}
