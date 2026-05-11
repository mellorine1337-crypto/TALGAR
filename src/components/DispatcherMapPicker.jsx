import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const DEFAULT_CENTER = [77.239467, 43.301778];
const DEFAULT_ZOOM = 13.8;
const TALGAR_BOUNDS = [
  [77.19, 43.275],
  [77.285, 43.335],
];

function normalizePoint(point) {
  if (!point) {
    return null;
  }

  const lat = Number(point.lat);
  const lon = Number(point.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
}

export default function DispatcherMapPicker({ token, value, onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const lastPointRef = useRef(normalizePoint(value));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!token || mapRef.current || !containerRef.current) {
      return undefined;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxBounds: TALGAR_BOUNDS,
      minZoom: 11.8,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const syncPoint = (point, { recenter = false } = {}) => {
      const normalizedPoint = normalizePoint(point);

      if (!normalizedPoint) {
        return;
      }

      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker({
          color: "#f97316",
          draggable: true,
        })
          .setLngLat([normalizedPoint.lon, normalizedPoint.lat])
          .addTo(map);

        markerRef.current.on("dragend", () => {
          const currentPoint = markerRef.current?.getLngLat();
          const nextPoint = normalizePoint({
            lat: currentPoint?.lat,
            lon: currentPoint?.lng,
          });

          if (!nextPoint) {
            return;
          }

          lastPointRef.current = nextPoint;
          onChangeRef.current(nextPoint);
        });
      } else {
        markerRef.current.setLngLat([normalizedPoint.lon, normalizedPoint.lat]);
      }

      if (recenter) {
        map.easeTo({
          center: [normalizedPoint.lon, normalizedPoint.lat],
          zoom: Math.max(map.getZoom(), 14),
          duration: 300,
        });
      }
    };

    map.on("click", (event) => {
      const nextPoint = normalizePoint({
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
      });

      if (!nextPoint) {
        return;
      }

      lastPointRef.current = nextPoint;
      syncPoint(nextPoint);
      onChangeRef.current(nextPoint);
    });

    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      lastPointRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const normalizedPoint = normalizePoint(value);

    if (!normalizedPoint) {
      lastPointRef.current = null;

      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 400,
      });

      return;
    }

    if (
      lastPointRef.current?.lat === normalizedPoint.lat &&
      lastPointRef.current?.lon === normalizedPoint.lon
    ) {
      return;
    }

    lastPointRef.current = normalizedPoint;

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({
        color: "#f97316",
        draggable: true,
      })
        .setLngLat([normalizedPoint.lon, normalizedPoint.lat])
        .addTo(map);

      markerRef.current.on("dragend", () => {
        const currentPoint = markerRef.current?.getLngLat();
        const nextPoint = normalizePoint({
          lat: currentPoint?.lat,
          lon: currentPoint?.lng,
        });

        if (!nextPoint) {
          return;
        }

        lastPointRef.current = nextPoint;
        onChangeRef.current(nextPoint);
      });
    } else {
      markerRef.current.setLngLat([normalizedPoint.lon, normalizedPoint.lat]);
    }
  }, [value]);

  if (!token) {
    return (
      <div className="map-placeholder">
        Добавь `VITE_MAPBOX_TOKEN` в `.env`, чтобы карта стала доступна диспетчеру.
      </div>
    );
  }

  return <div ref={containerRef} className="dispatcher-map" />;
}
