import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ToolResult, useAppBridge } from "./useAppBridge.js";

interface DashboardState {
  prefectureCode: string;
  fieldId: string | null;
  attribution: string;
}

interface FieldFeature {
  type: "Feature";
  properties: { fieldId: string; areaM2: number; registeredCrop: string | null };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface FieldFeatureCollection {
  type: "FeatureCollection";
  features: FieldFeature[];
  attribution: string;
}

const DEFAULT_CENTER: [number, number] = [130.7625, 31.735]; // Kirishima, Kagoshima
const DEFAULT_ZOOM = 9;

/**
 * Compose the full dashboard. Layout:
 *  - Header: prefecture picker, refresh button.
 *  - Main: map (left) + side pane with selected field details and weather.
 *  - Footer: attribution.
 *
 * All data flows through the MCP `tools/call` round-trip via `useAppBridge`.
 * The host environment provides the bridge; we never embed secrets or
 * pre-authenticated URLs in the UI bundle.
 */
export function Dashboard(): JSX.Element {
  const bridge = useAppBridge<DashboardState>({
    prefectureCode: "JP-46",
    fieldId: null,
    attribution: "Loading…",
  });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [fields, setFields] = useState<FieldFeature[]>([]);
  const [selectedField, setSelectedField] = useState<FieldFeature | null>(null);
  const [weatherSummary, setWeatherSummary] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initialise map once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: minimalRasterStyle(),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© OpenStreetMap contributors",
      }),
    );
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch viewport farms when map idles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onIdle = async () => {
      const bounds = map.getBounds();
      try {
        const result = await bridge.callTool("fetch_field_geojson", {
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
          limit: 200,
        });
        const collection = extractStructured<FieldFeatureCollection>(result);
        setFields(collection?.features ?? []);
        if (collection?.attribution) {
          bridge.setState((s) => ({ ...s, attribution: collection.attribution }));
        }
        setLoadError(null);
      } catch (err) {
        setLoadError((err as Error).message);
      }
    };
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [bridge]);

  // Render farm centroids as point markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handle = map.getSource("fields") as maplibregl.GeoJSONSource | undefined;
    const data: FieldFeatureCollection = {
      type: "FeatureCollection",
      features: fields,
      attribution: bridge.state.attribution,
    };
    if (handle) {
      handle.setData(data as unknown as GeoJSON.FeatureCollection);
    } else {
      map.on("load", () => {
        if (!map.getSource("fields")) {
          map.addSource("fields", {
            type: "geojson",
            data: data as unknown as GeoJSON.FeatureCollection,
          });
          map.addLayer({
            id: "fields-layer",
            type: "circle",
            source: "fields",
            paint: {
              "circle-radius": 5,
              "circle-color": "#0f7a3f",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.5,
            },
          });
          map.on("click", "fields-layer", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const fieldId = (f.properties as { fieldId?: string } | null)?.fieldId;
            if (!fieldId) return;
            void selectField(fieldId);
          });
        }
      });
    }
  }, [fields, bridge.state.attribution]);

  async function selectField(fieldId: string): Promise<void> {
    const result = await bridge.callTool("select_field", { fieldId });
    const sc = extractStructured<{
      found: boolean;
      field?: FieldFeature["properties"] & { centroid: { lat: number; lng: number } };
    }>(result);
    if (!sc?.found || !sc.field) {
      return;
    }
    bridge.setState((s) => ({ ...s, fieldId }));
    setSelectedField({
      type: "Feature",
      properties: {
        fieldId,
        areaM2: sc.field.areaM2,
        registeredCrop: sc.field.registeredCrop,
      },
      geometry: { type: "Point", coordinates: [sc.field.centroid.lng, sc.field.centroid.lat] },
    });
    const wx = await bridge.callTool("fetch_weather_layer", {
      lat: sc.field.centroid.lat,
      lng: sc.field.centroid.lng,
      metric: "temperature",
    });
    const wxSc = extractStructured<{ value: number | null; metric: string; time?: string }>(wx);
    if (wxSc && typeof wxSc.value === "number") {
      setWeatherSummary(`${wxSc.metric}=${wxSc.value.toFixed(1)} @ ${wxSc.time ?? "now"}`);
    } else {
      setWeatherSummary("Weather unavailable");
    }
    bridge.updateModelContext({
      currentField: fieldId,
      weather: weatherSummary,
    });
  }

  const sortedFields = useMemo(() => {
    return [...fields].slice(0, 25);
  }, [fields]);

  return (
    <div className="app">
      {!bridge.hasHost && (
        <output className="banner standalone-preview">
          Standalone preview — no MCP Apps host detected. Tool calls are stubbed.
        </output>
      )}
      <header className="app-header">
        <div className="app-title">AgriOps MCP</div>
        <div className="app-controls">
          <select
            value={bridge.state.prefectureCode}
            onChange={(e) => bridge.setState((s) => ({ ...s, prefectureCode: e.target.value }))}
          >
            <option value="JP-46">鹿児島県</option>
            <option value="JP-45">宮崎県</option>
            <option value="JP-43">熊本県</option>
          </select>
          <button
            type="button"
            className="primary"
            onClick={() => mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })}
          >
            Reset view
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="map-pane" ref={mapContainerRef} />
        <aside className="side-pane">
          {loadError && <div className="banner">⚠ {loadError}</div>}
          <section className="card">
            <h2>Selected field</h2>
            {selectedField ? (
              <div className="kv">
                <span className="kv-key">Field ID</span>
                <span>{selectedField.properties.fieldId}</span>
                <span className="kv-key">Area</span>
                <span>{(selectedField.properties.areaM2 / 10_000).toFixed(2)} ha</span>
                <span className="kv-key">Crop</span>
                <span>{selectedField.properties.registeredCrop ?? "—"}</span>
                <span className="kv-key">Weather</span>
                <span>{weatherSummary || "—"}</span>
              </div>
            ) : (
              <div className="kv-key">Click a polygon on the map to inspect.</div>
            )}
          </section>
          <section className="card">
            <h2>In viewport ({fields.length})</h2>
            <ul className="field-list">
              {sortedFields.map((f) => (
                <li
                  key={f.properties.fieldId}
                  className={
                    selectedField?.properties.fieldId === f.properties.fieldId ? "selected" : ""
                  }
                  onClick={() => void selectField(f.properties.fieldId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void selectField(f.properties.fieldId);
                  }}
                >
                  {f.properties.fieldId} · {(f.properties.areaM2 / 10_000).toFixed(2)} ha
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      <footer className="app-footer">
        <div className="attribution">{bridge.state.attribution}</div>
      </footer>
    </div>
  );
}

function extractStructured<T>(result: ToolResult): T | null {
  if (!result || typeof result !== "object") return null;
  const sc = (result as { structuredContent?: unknown }).structuredContent;
  return (sc ?? null) as T | null;
}

/**
 * Minimal raster style using OpenStreetMap tiles. We keep the style inline
 * rather than fetching an external style.json because the MCP Apps host
 * may CSP-block additional network requests.
 */
function minimalRasterStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm-layer",
        type: "raster",
        source: "osm",
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
}
