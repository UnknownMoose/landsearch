"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
      center: [-2.2, 55.2],
      zoom: 8
    });

    map.on("load", () => {
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${process.env.NEXT_PUBLIC_TILESERVER_URL}/api/tiles/parcels/{z}/{x}/{y}`],
        minzoom: 5,
        maxzoom: 16
      });

      map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels", "source-layer": "parcels", paint: { "fill-color": "#22c55e", "fill-opacity": 0.15 } });
      map.addLayer({ id: "parcels-line", type: "line", source: "parcels", "source-layer": "parcels", paint: { "line-color": "#16a34a", "line-width": 1.2 } });

      map.on("click", "parcels-fill", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const p = feature.properties || {};
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>INSPIRE:</strong> ${p.inspire_id || "n/a"}<br/><strong>Acres:</strong> ${Number(p.area_acres || 0).toFixed(2)}<br/><strong>Hectares:</strong> ${Number(p.area_hectares || 0).toFixed(2)}<br/><strong>Title ref:</strong> placeholder`).addTo(map);
      });
    });

    return () => map.remove();
  }, []);

  return <div className="h-[calc(100vh-4rem)] w-full" ref={ref} />;
}
