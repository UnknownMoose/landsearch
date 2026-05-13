"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

function getTileBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_TILESERVER_URL?.trim();
  if (!configured) return "";
  return configured.replace(/\/$/, "");
}

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
      const tileBaseUrl = getTileBaseUrl();
      let selectedParcelId: string | number | null = null;
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${tileBaseUrl}/api/tiles/parcels/{z}/{x}/{y}`],
        minzoom: 10,
        maxzoom: 16
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 11,
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.15 }
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 11,
        paint: { "line-color": "#16a34a", "line-width": 1.2 }
      });
      map.addLayer({
        id: "parcels-selected-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 11,
        filter: ["==", ["get", "id"], ""],
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: "parcels-selected-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 11,
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#b45309", "line-width": 2.5 }
      });

      map.on("click", "parcels-fill", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const p = feature.properties || {};
        selectedParcelId = p.id ?? null;
        if (selectedParcelId !== null) {
          map.setFilter("parcels-selected-fill", ["==", ["get", "id"], selectedParcelId]);
          map.setFilter("parcels-selected-line", ["==", ["get", "id"], selectedParcelId]);
        }
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>INSPIRE:</strong> ${p.inspire_id || "n/a"}<br/><strong>Acres:</strong> ${Number(p.area_acres || 0).toFixed(2)}<br/><strong>Hectares:</strong> ${Number(p.area_hectares || 0).toFixed(2)}<br/><strong>Title ref:</strong> placeholder`).addTo(map);
      });
    });

    return () => map.remove();
  }, []);

  return <div className="h-[calc(100vh-4rem)] w-full" ref={ref} />;
}
