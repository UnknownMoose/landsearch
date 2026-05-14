"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FormEvent, useEffect, useRef, useState } from "react";

function getTileBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_TILESERVER_URL?.trim();
  if (!configured) return "";
  return configured.replace(/\/$/, "");
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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
          },
          labels: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
              "https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO"
          }
        },
        layers: [
          { id: "satellite", type: "raster", source: "satellite" },
          { id: "place-labels", type: "raster", source: "labels" }
        ]
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
        minzoom: 12,
        maxzoom: 16
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
        paint: { "fill-color": "#22c55e", "fill-opacity": 0 }
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
        paint: { "line-color": "#10b981", "line-width": 2 }
      });
      map.addLayer({
        id: "parcels-selected-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
        filter: ["==", ["get", "id"], ""],
        paint: { "fill-color": "#7c3aed", "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: "parcels-selected-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
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

    mapRef.current = map;

    return () => map.remove();
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q || !mapRef.current) return;
    setIsSearching(true);
    setSearchError(null);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      const match = results[0];
      if (!match) {
        setSearchError("No place found. Try a nearby village, farm or forest name.");
        return;
      }
      const center: [number, number] = [Number(match.lon), Number(match.lat)];
      mapRef.current.flyTo({ center, zoom: 13.5, essential: true });
      new maplibregl.Popup({ closeButton: false, closeOnClick: true })
        .setLngLat(center)
        .setHTML(`<div class="parcel-popup"><strong>${match.display_name}</strong></div>`)
        .addTo(mapRef.current);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      <form className="absolute left-3 top-3 z-10 flex w-[min(38rem,calc(100%-1.5rem))] gap-2 rounded-md bg-black/80 p-2" onSubmit={handleSearch}>
        <input className="w-full rounded bg-white px-3 py-2 text-sm text-black" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search places (e.g. Kielder Forest, Otterburn, Rothbury)" />
        <button className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold text-white" disabled={isSearching} type="submit">{isSearching ? "Searching..." : "Search"}</button>
      </form>
      {searchError ? <p className="absolute left-3 top-16 z-10 rounded bg-red-950/90 px-3 py-1 text-xs text-red-100">{searchError}</p> : null}
      <div className="h-full w-full" ref={ref} />
    </div>
  );
}
