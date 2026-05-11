import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const DEFAULT_CENTER = [77.239467, 43.301778];
const DEFAULT_ZOOM = 13.8;
const TALGAR_BOUNDS = [
  [77.19, 43.275],
  [77.285, 43.335],
];

function formatLastSeen(value) {
  if (!value) {
    return "нет сигнала";
  }

  return new Date(value).toLocaleString("ru-RU");
}

function formatSpeed(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }

  return `${Math.round(Number(value) * 3.6)} км/ч`;
}

function buildPopupContent(item) {
  const root = document.createElement("div");
  root.className = "fleet-popup";

  const title = document.createElement("strong");
  title.textContent = item.name;
  root.appendChild(title);

  const lines = [
    item.plateNumber || "Госномер не указан",
    `Заказов завершено сегодня: ${item.completedTodayCount}`,
    `В работе: ${item.inProgressCount}`,
    `Скорость: ${formatSpeed(item.lastLocation?.speed)}`,
    `Последний сигнал: ${formatLastSeen(item.lastSeenAt)}`,
  ];

  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line;
    root.appendChild(row);
  }

  return root;
}

export default function DispatcherFleetMap({ token, fleet }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const didFitBoundsRef = useRef(false);

  useEffect(() => {
    if (!token || mapRef.current || !containerRef.current) {
      return undefined;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/navigation-day-v1",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxBounds: TALGAR_BOUNDS,
      minZoom: 11.8,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      for (const marker of markersRef.current) {
        marker.remove();
      }

      markersRef.current = [];
      didFitBoundsRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    for (const marker of markersRef.current) {
      marker.remove();
    }

    markersRef.current = [];

    const visibleFleet = fleet.filter((item) => item.lastLocation);

    if (!visibleFleet.length) {
      didFitBoundsRef.current = false;
      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 400,
      });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();

    for (const item of visibleFleet) {
      const markerNode = document.createElement("button");
      markerNode.type = "button";
      markerNode.className = `fleet-marker ${item.isOnline ? "live" : "stale"}`;
      markerNode.setAttribute("aria-label", item.name);

      const popup = new mapboxgl.Popup({ offset: 18 }).setDOMContent(
        buildPopupContent(item)
      );

      const marker = new mapboxgl.Marker({ element: markerNode })
        .setLngLat([item.lastLocation.lon, item.lastLocation.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([item.lastLocation.lon, item.lastLocation.lat]);
    }

    if (!didFitBoundsRef.current) {
      if (visibleFleet.length === 1) {
        const item = visibleFleet[0];
        map.easeTo({
          center: [item.lastLocation.lon, item.lastLocation.lat],
          zoom: 14,
          duration: 300,
        });
      } else {
        map.fitBounds(bounds, {
          padding: 40,
          maxZoom: 14,
          duration: 350,
        });
      }

      didFitBoundsRef.current = true;
    }
  }, [fleet]);

  if (!token) {
    return (
      <div className="map-placeholder">
        Добавь `VITE_MAPBOX_TOKEN` в `.env`, чтобы диспетчер видел машины на карте.
      </div>
    );
  }

  if (!fleet.some((item) => item.lastLocation)) {
    return (
      <div className="map-placeholder">
        Как только водитель откроет свою панель и даст доступ к геолокации, машина
        появится здесь.
      </div>
    );
  }

  return <div ref={containerRef} className="dispatcher-map fleet-map" />;
}
