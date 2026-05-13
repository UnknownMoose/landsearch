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
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            ],
            tileSize: 256,
            attribution: "© Esri"
          }
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }]
      },
      center: [-2.2, 55.2],
      zoom: 8
    });

    map.on("load", () => {
      const tileBaseUrl = getTileBaseUrl();
      let selectedParcelId: string | number | null = null;
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${tileBaseUrl}/api/tiles/parcels/{z}/{x}/{y}`],
        minzoom: 8,
        maxzoom: 16
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 8,
        paint: { "fill-color": "#22c55e", "fill-opacity": 0 }
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 8,
        paint: { "line-color": "#10b981", "line-width": 2 }
      });
      map.addLayer({
        id: "parcels-selected-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 8,
        filter: ["==", ["get", "id"], ""],
        paint: { "fill-color": "#7c3aed", "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: "parcels-selected-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 8,
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#6d28d9", "line-width": 2.8 }
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
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<div class="parcel-popup"><strong>INSPIRE:</strong> ${p.inspire_id || "n/a"}<br/><strong>Acres:</strong> ${Number(p.area_acres || 0).toFixed(2)}<br/><strong>Hectares:</strong> ${Number(p.area_hectares || 0).toFixed(2)}<br/><strong>Title ref:</strong> placeholder</div>`).addTo(map);
      });
    });

    return () => map.remove();
  }, []);

  return <div className="h-[calc(100vh-4rem)] w-full" ref={ref} />;
}
