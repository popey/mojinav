import { describe, expect, it } from "vitest";

import { decodePolyline } from "./polyline";


describe("decodePolyline", () => {
  it("decodes the canonical Google encoded-polyline example as longitude/latitude pairs", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("returns no coordinates for an empty polyline", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("rejects a truncated coordinate instead of returning bogus coordinates", () => {
    expect(() => decodePolyline("?")).toThrow("Invalid encoded polyline");
  });
});
