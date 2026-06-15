import { useCallback, useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer } from 'react-leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Layer, PathOptions } from 'leaflet';
import { Download, MapPinned, RefreshCw } from 'lucide-react';

type BoundaryProperties = {
  DISTRICT?: string;
  ST_NM?: string;
};

type BoundaryFeature = Feature<Geometry, BoundaryProperties>;
type NfhsRecord = Record<string, string | number | null>;
type MetricCatalogRow = {
  metricName: string;
  metricLabel: string;
  category: string;
  interpretation: 'higher_is_better' | 'lower_is_better' | 'context_only';
  interpretationNote: string;
};
type MetricValueRow = {
  districtName: string;
  stateUt: string;
  rawValue: string;
  suppressed: boolean;
  smallSample: boolean;
  value: number | null;
};
type BoundaryMatch = {
  row?: MetricValueRow;
  matchedBy: 'state_district' | 'district_only' | 'none';
};

const DEFAULT_METRIC = 'hh_improved_water_pct';
const GOOD_COLOR = '#138A6A';
const MID_COLOR = '#F0B429';
const BAD_COLOR = '#EB1600';
const CONTEXT_LOW = '#D8E7F3';
const CONTEXT_HIGH = '#246B8F';
const NO_DATA_COLOR = '#D4D0C8';
const SUPPRESSED_COLOR = '#8D8A84';

const EXCLUDED_COLUMNS = new Set([
  'district_name',
  'state_ut',
  'households_surveyed',
  'women_15_49_interviewed',
  'men_15_54_interviewed',
]);

const normalize = (value: string | undefined | null) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

const normalizeState = (value: string | undefined | null) => {
  const key = normalize(value);
  const aliases: Record<string, string> = {
    andamanandnicobarisland: 'andamanandnicobarislands',
    arunanchalpradesh: 'arunachalpradesh',
    dadaraandnagarhavelli: 'dadranagarhavelidamananddiu',
    damananddiu: 'dadranagarhavelidamananddiu',
    maharastra: 'maharashtra',
  };

  return aliases[key] ?? key;
};

const metricLabel = (columnName: string) =>
  columnName
    .replace(/_pct$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bHh\b/g, 'Household');

const inferCategory = (metricName: string) => {
  if (/^(hh_|households_)|electricity|water|sanitation|clean_fuel/.test(metricName)) return 'Household infrastructure';
  if (/^fp_|family|menstrual/.test(metricName)) return 'Family planning and reproductive health';
  if (/mothers_|pregnanc|birth|delivery|pnc|anc/.test(metricName)) return 'Maternal and newborn care';
  if (/child_12_23m|vaccin|bcg|polio|penta|rotavirus|mcv|vit_a/.test(metricName)) return 'Child immunization';
  if (/diarrhoea|ari|fever/.test(metricName)) return 'Child illness and treatment';
  if (/breastfed|diet|stunted|wasted|underweight|overweight/.test(metricName)) return 'Nutrition';
  if (/anaemic|bmi|blood_sugar|bp_|tobacco|alcohol|cervical|breast_exam|oral_cancer/.test(metricName)) {
    return 'Adult health and screening';
  }
  if (/schooled|literate|schooling|pre_primary/.test(metricName)) return 'Education and demographics';
  return 'Population profile';
};

const inferInterpretation = (metricName: string): MetricCatalogRow['interpretation'] => {
  if (
    /unmet|married_before_age_18|already_mothers_or_pregnant|birth_3|out_of_pocket|^prev_diarrhoea|ari_2_pct|stunted|wasted|underweight|overweight|anaemic|blood_sugar|high_bp|tobacco|alcohol/.test(
      metricName,
    )
  ) {
    return 'lower_is_better';
  }
  if (/sex_ratio|population_below_age|csection/.test(metricName)) return 'context_only';
  return 'higher_is_better';
};

const interpretationNote = (interpretation: MetricCatalogRow['interpretation']) => {
  if (interpretation === 'lower_is_better') {
    return 'Lower values generally indicate less disease burden, lower risk, or fewer access barriers.';
  }
  if (interpretation === 'context_only') {
    return 'Context metric; compare carefully rather than ranking good versus bad automatically.';
  }
  return 'Higher values generally indicate better coverage, access, utilization, or service uptake.';
};

const parseValue = (rawInput: string | number | null | undefined) => {
  const rawValue = String(rawInput ?? '').trim();
  const suppressed = rawValue === '*';
  const smallSample = rawValue.startsWith('(') && rawValue.endsWith(')');
  const cleaned = rawValue.replace(/^\((.*)\)$/, '$1').replaceAll(',', '').replaceAll('*', '');
  const parsed = Number(cleaned);

  return {
    rawValue,
    suppressed,
    smallSample,
    value: Number.isFinite(parsed) ? parsed : null,
  };
};

const interpolateColor = (start: string, end: string, amount: number) => {
  const ratio = Math.max(0, Math.min(1, amount));
  const from = start.match(/\w\w/g)?.map((hex) => parseInt(hex, 16)) ?? [0, 0, 0];
  const to = end.match(/\w\w/g)?.map((hex) => parseInt(hex, 16)) ?? [0, 0, 0];
  const result = from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio));
  return `#${result.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const scoreForValue = (value: number, min: number, max: number, interpretation: MetricCatalogRow['interpretation']) => {
  if (max === min) return 0.5;
  const normalized = (value - min) / (max - min);
  return interpretation === 'lower_is_better' ? 1 - normalized : normalized;
};

const scoreToColor = (score: number, interpretation: MetricCatalogRow['interpretation']) => {
  if (interpretation === 'context_only') return interpolateColor(CONTEXT_LOW, CONTEXT_HIGH, score);
  if (score < 0.5) return interpolateColor(BAD_COLOR, MID_COLOR, score * 2);
  return interpolateColor(MID_COLOR, GOOD_COLOR, (score - 0.5) * 2);
};

const formatValue = (row: MetricValueRow | undefined) => {
  if (!row) return 'No matching NFHS row';
  if (row.suppressed) return 'Suppressed';
  if (row.value === null) return row.rawValue || 'No value';
  return `${row.value.toFixed(1)}${row.smallSample ? ' (small sample)' : ''}`;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] ?? char);

const buildMarkdownReport = (metric: MetricCatalogRow, rows: MetricValueRow[], min: number, max: number) => {
  const numericRows = rows.filter((row) => row.value !== null);
  const suppressedRows = rows.filter((row) => row.suppressed || row.value === null);
  const average = numericRows.reduce((sum, row) => sum + (row.value ?? 0), 0) / Math.max(1, numericRows.length);
  const gapRows = [...numericRows].sort((a, b) =>
    metric.interpretation === 'lower_is_better' ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0),
  );
  const strongestRows = [...numericRows].sort((a, b) =>
    metric.interpretation === 'lower_is_better' ? (a.value ?? 0) - (b.value ?? 0) : (b.value ?? 0) - (a.value ?? 0),
  );
  const listRows = (items: MetricValueRow[]) =>
    items
      .slice(0, 12)
      .map((row, index) => `${index + 1}. ${row.districtName}, ${row.stateUt}: ${row.value?.toFixed(1)}`)
      .join('\n');

  return [
    '# NFHS India District Health Map Report',
    '',
    `Metric: ${metric.metricLabel}`,
    `Category: ${metric.category}`,
    `Interpretation: ${metric.interpretationNote}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '## National Overview',
    '',
    `- District records: ${rows.length}`,
    `- Numeric estimates: ${numericRows.length}`,
    `- Suppressed or non-numeric estimates: ${suppressedRows.length}`,
    `- Unweighted district average: ${average.toFixed(1)}`,
    `- Range: ${min.toFixed(1)} to ${max.toFixed(1)}`,
    '',
    '## Priority Coverage Gaps',
    '',
    listRows(gapRows),
    '',
    '## Strongest Districts',
    '',
    listRows(strongestRows),
    '',
    '## Data Caveats',
    '',
    'This report treats parenthesized NFHS values as small-sample estimates and asterisks as suppressed estimates. District boundary matching uses a bundled Census 2011 DataMeet layer, so newer NFHS districts and state reorganizations may not map one-to-one.',
  ].join('\n');
};

export default function App() {
  const [records, setRecords] = useState<NfhsRecord[]>([]);
  const [boundaries, setBoundaries] = useState<FeatureCollection<Geometry, BoundaryProperties> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState(DEFAULT_METRIC);
  const [hovered, setHovered] = useState<{ district: string; state: string; row?: MetricValueRow } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/data/nfhs_records.json').then((response) => response.json() as Promise<NfhsRecord[]>),
      fetch('/data/india_districts.geojson').then((response) => response.json() as Promise<FeatureCollection<Geometry, BoundaryProperties>>),
    ])
      .then(([nfhsRows, geojson]) => {
        setRecords(nfhsRows);
        setBoundaries(geojson);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load static data');
      });
  }, []);

  const catalog = useMemo(() => {
    const columns = records[0] ? Object.keys(records[0]) : [];
    return columns
      .filter((column) => !EXCLUDED_COLUMNS.has(column))
      .map((metricName) => {
        const interpretation = inferInterpretation(metricName);
        return {
          metricName,
          metricLabel: metricLabel(metricName),
          category: inferCategory(metricName),
          interpretation,
          interpretationNote: interpretationNote(interpretation),
        };
      })
      .sort((a, b) => `${a.category}${a.metricLabel}`.localeCompare(`${b.category}${b.metricLabel}`));
  }, [records]);

  useEffect(() => {
    if (catalog.length > 0 && !catalog.some((metric) => metric.metricName === selectedMetric)) {
      setSelectedMetric(catalog[0].metricName);
    }
  }, [catalog, selectedMetric]);

  const metric = catalog.find((item) => item.metricName === selectedMetric) ?? catalog[0];

  const rows = useMemo<MetricValueRow[]>(() => {
    if (!metric) return [];
    return records
      .map((record) => {
        const parsed = parseValue(record[metric.metricName]);
        return {
          districtName: String(record.district_name ?? '').trim(),
          stateUt: String(record.state_ut ?? '').trim(),
          ...parsed,
        };
      })
      .sort((a, b) => `${a.stateUt}${a.districtName}`.localeCompare(`${b.stateUt}${b.districtName}`));
  }, [metric, records]);

  const metricsByStateDistrict = useMemo(() => {
    const map = new Map<string, MetricValueRow>();
    rows.forEach((row) => map.set(`${normalizeState(row.stateUt)}|${normalize(row.districtName)}`, row));
    return map;
  }, [rows]);

  const metricsByDistrict = useMemo(() => {
    const map = new Map<string, MetricValueRow[]>();
    rows.forEach((row) => {
      const key = normalize(row.districtName);
      map.set(key, [...(map.get(key) ?? []), row]);
    });
    return map;
  }, [rows]);

  const numericValues = useMemo(() => rows.map((row) => row.value).filter((value): value is number => value !== null), [rows]);
  const min = numericValues.length ? Math.min(...numericValues) : 0;
  const max = numericValues.length ? Math.max(...numericValues) : 0;
  const average = numericValues.reduce((sum, value) => sum + value, 0) / Math.max(1, numericValues.length);

  const findMatch = useCallback(
    (feature: BoundaryFeature): BoundaryMatch => {
      const district = normalize(feature.properties?.DISTRICT);
      const state = normalizeState(feature.properties?.ST_NM);
      const direct = metricsByStateDistrict.get(`${state}|${district}`);
      if (direct) return { row: direct, matchedBy: 'state_district' };

      const districtMatches = metricsByDistrict.get(district) ?? [];
      if (districtMatches.length === 1) return { row: districtMatches[0], matchedBy: 'district_only' };

      return { matchedBy: 'none' };
    },
    [metricsByDistrict, metricsByStateDistrict],
  );

  const boundaryStats = useMemo(() => {
    const features = (boundaries?.features ?? []) as BoundaryFeature[];
    return features.reduce(
      (acc, feature) => {
        const match = findMatch(feature);
        acc.total += 1;
        if (match.matchedBy === 'state_district') acc.direct += 1;
        if (match.matchedBy === 'district_only') acc.fallback += 1;
        if (match.matchedBy === 'none') acc.unmatched += 1;
        return acc;
      },
      { direct: 0, fallback: 0, total: 0, unmatched: 0 },
    );
  }, [boundaries, findMatch]);

  const gapRows = useMemo(() => {
    const numericRows = rows.filter((row) => row.value !== null);
    return [...numericRows]
      .sort((a, b) => (metric?.interpretation === 'lower_is_better' ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)))
      .slice(0, 8);
  }, [metric?.interpretation, rows]);

  const stateSummary = useMemo(() => {
    const groups = new Map<string, { total: number; count: number }>();
    rows.forEach((row) => {
      if (row.value === null) return;
      const current = groups.get(row.stateUt) ?? { total: 0, count: 0 };
      groups.set(row.stateUt, { total: current.total + row.value, count: current.count + 1 });
    });

    return [...groups.entries()]
      .map(([state, group]) => ({ state, average: group.total / group.count }))
      .sort((a, b) => (metric?.interpretation === 'lower_is_better' ? b.average - a.average : a.average - b.average))
      .slice(0, 7);
  }, [metric?.interpretation, rows]);

  const featureStyle = (feature?: Feature<Geometry, BoundaryProperties>): PathOptions => {
    if (!feature || !metric) return {};
    const match = findMatch(feature);

    if (!match.row || match.row.value === null) {
      return { color: '#FFFFFF', fillColor: NO_DATA_COLOR, fillOpacity: 0.45, opacity: 0.7, weight: 0.6 };
    }

    if (match.row.suppressed) {
      return { color: '#FFFFFF', fillColor: SUPPRESSED_COLOR, fillOpacity: 0.55, opacity: 0.8, weight: 0.6 };
    }

    const score = scoreForValue(match.row.value, min, max, metric.interpretation);
    return { color: '#FFFFFF', fillColor: scoreToColor(score, metric.interpretation), fillOpacity: 0.85, opacity: 0.9, weight: 0.6 };
  };

  const bindFeature = (feature: Feature<Geometry, BoundaryProperties>, layer: Layer) => {
    if (!metric) return;
    const match = findMatch(feature);
    const district = feature.properties?.DISTRICT ?? 'Unknown district';
    const state = feature.properties?.ST_NM ?? 'Unknown state';
    const tooltip = [
      `<strong>${escapeHtml(district)}</strong>`,
      `<span>${escapeHtml(state)}</span>`,
      `<span>${escapeHtml(metric.metricLabel)}: ${escapeHtml(formatValue(match.row))}</span>`,
      match.matchedBy === 'district_only' ? '<span>Matched by district name</span>' : '',
    ]
      .filter(Boolean)
      .join('<br />');

    layer.bindTooltip(tooltip, { direction: 'top', sticky: true });
    layer.on({
      mouseover: () => setHovered({ district, state, row: match.row }),
      mouseout: () => setHovered(null),
    });
  };

  const exportReport = () => {
    if (!metric) return;
    const report = buildMarkdownReport(metric, rows, min, max);
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${metric.metricName}_nfhs_report.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loading = !records.length || !boundaries || !metric;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">
            <MapPinned size={16} />
            NFHS-5 district indicators
          </div>
          <h1>India Health Coverage Map</h1>
        </div>
        <div className="controls">
          <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)} aria-label="Health metric">
            {catalog.map((item) => (
              <option key={item.metricName} value={item.metricName}>
                {item.category}: {item.metricLabel}
              </option>
            ))}
          </select>
          <button type="button" onClick={exportReport} disabled={!rows.length}>
            <Download size={16} />
            Export Report
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="layout">
        <div className="map-panel">
          {loading ? (
            <div className="loading">Loading map data...</div>
          ) : (
            <MapContainer center={[22.5, 80]} zoom={4} minZoom={3} maxZoom={8} scrollWheelZoom className="map">
              <GeoJSON key={`${selectedMetric}-${rows.length}`} data={boundaries} style={featureStyle} onEachFeature={bindFeature} />
            </MapContainer>
          )}
        </div>

        <aside className="sidebar">
          <Panel title={metric?.metricLabel ?? 'Selected metric'}>
            <p className="muted">{metric?.interpretationNote}</p>
            <div className="badges">
              <span>{metric?.category ?? 'Loading'}</span>
              <span>{metric?.interpretation.replaceAll('_', ' ') ?? 'Loading'}</span>
            </div>
            <div className="stats-grid">
              <Stat label="District rows" value={rows.length.toLocaleString()} />
              <Stat label="Numeric estimates" value={numericValues.length.toLocaleString()} />
              <Stat label="Average" value={Number.isFinite(average) ? average.toFixed(1) : 'NA'} />
              <Stat label="Range" value={`${min.toFixed(1)}-${max.toFixed(1)}`} />
            </div>
          </Panel>

          <Panel title="Boundary Match">
            <div className="stats-grid">
              <Stat label="Boundaries" value={boundaryStats.total.toLocaleString()} />
              <Stat label="Direct matches" value={boundaryStats.direct.toLocaleString()} />
              <Stat label="District fallback" value={boundaryStats.fallback.toLocaleString()} />
              <Stat label="Unmatched" value={boundaryStats.unmatched.toLocaleString()} />
            </div>
          </Panel>

          <Panel title="Hover Detail">
            {hovered ? (
              <div>
                <div className="hover-title">{hovered.district}</div>
                <div className="muted">{hovered.state}</div>
                <div className="hover-value">{formatValue(hovered.row)}</div>
              </div>
            ) : (
              <div className="hover-empty">
                <RefreshCw size={16} />
                Move across a district
              </div>
            )}
          </Panel>

          <Panel title="Priority Gaps">
            <List rows={gapRows} />
          </Panel>

          <Panel title="State Snapshot">
            {stateSummary.map((row) => (
              <div key={row.state} className="state-row">
                <span>{row.state}</span>
                <strong>{row.average.toFixed(1)}</strong>
              </div>
            ))}
          </Panel>

          <p className="attribution">
            District boundaries: DataMeet Census 2011 layer, Creative Commons Attribution 2.5 India. Source values: static NFHS-5 export
            from the hackathon workspace.
          </p>
        </aside>
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function List({ rows }: { rows: MetricValueRow[] }) {
  return (
    <div className="list">
      {rows.map((row) => (
        <div key={`${row.stateUt}-${row.districtName}`} className="list-row">
          <div>
            <strong>{row.districtName}</strong>
            <span>{row.stateUt}</span>
          </div>
          <b>{row.value?.toFixed(1)}</b>
        </div>
      ))}
    </div>
  );
}
