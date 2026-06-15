# Hackathon Initial Data Exploration

Analyzed dataset:

`databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset`

## Tables Reviewed

| Table | Rows | Notes |
|---|---:|---|
| `facilities` | 10,088 | Health facility/entity data with contact, address, service, social, and geospatial fields. |
| `india_post_pincode_directory` | 165,627 | India Post office/pincode directory; not one row per pincode. |
| `nfhs_5_district_health_indicators` | 706 | District-level NFHS-5 health indicators. |

## Executive Summary

The hackathon data is usable, but it needs curation before analytical or operational use. The biggest issues are duplicate identifiers in `facilities`, non-unique pincodes in the India Post table, domain-specific missing value markers in NFHS, and geospatial quality problems.

The most important correction is to separate source-row IDs from entity-level IDs. `facilities.unique_id` is not a reliable primary key for unique facilities. It should be retained as a source identifier, while a curated `facility_entity_id` should be generated through deterministic normalization plus fuzzy matching.

## Facilities Table

### Completeness

`facilities` has 10,088 rows. Core fields are mostly present, but several fields have meaningful gaps:

| Field / Measure | Missing or Problem Rows |
|---|---:|
| `name` | 54 |
| `address_line1` | 58 |
| `address_city` | 58 |
| `address_stateOrRegion` | 58 |
| `address_zipOrPostcode` | 58 |
| `officialPhone` | 57 |
| `email` | 57 |
| `officialWebsite` | 58 |
| `latitude` / `longitude` | 118 |
| Coordinates outside India bounding box | 6 |
| `yearEstablished` | 58 |
| `facilityTypeId` | 67 |
| `operatorTypeId` | 73 |
| `numberDoctors` | 113 |
| `capacity` | 114 |
| `description` | 80 |
| `specialties` | 115 |
| `procedure` | 839 |
| `equipment` | 2,295 |
| `capability` | 134 |
| Social metrics fields | ~117 |

### Identifier Quality

`unique_id` is not truly unique:

- Total rows: 10,088
- Distinct `unique_id`: 10,077
- Duplicate `unique_id` values: 11

Examples of duplicate `unique_id` values include:

- `MOSC Medical College Hospital`
- `Malhotra Super Speciality Hospital`
- `Sabine Hospital and Research Centre`
- `Trustwell Hospitals`
- `Sanjivani Multi Speciality Hospital`

These duplicated IDs often point to the same apparent facility record shape, so some are exact duplicates. There are also likely duplicate facilities with different `unique_id`s, such as:

- `Sarla Hospital`, Mumbai, Maharashtra, `400054`
- `Siri Dental Hospital`, Hyderabad, Telangana, `500060`

### Geospatial Issues

118 facilities are missing latitude/longitude. Six rows have coordinates outside a rough India bounding box. Examples include:

- `Sanjivani Multi Speciality Hospital`, Kerala, has `lat=59.9497`, `lon=-38.2626`.
- `Krishna Hospital Multispeciality`, Lucknow, has `lat=-81.7063`, `lon=26.9531`.
- `Cura Imaging & Gastro Clinic`, Nagpur, has `lat=2.9529`, `lon=41.3872`.

These are not plausible India facility coordinates and should be re-geocoded or quarantined.

### Pincode Joinability

Facility pincodes can be normalized by stripping non-digits:

- Total facilities: 10,088
- Missing raw pincode: 58
- Valid six-digit pincode after normalization: 9,929
- Matched to India Post pincode directory: 9,717
- Valid six-digit format but not found in India Post directory: 212

This is a strong enrichment path, but the pincode directory must be aggregated before joining at pincode level.

## India Post Pincode Directory

### Completeness and Grain

The table has 165,627 rows and 19,586 distinct pincodes. It should be treated as post-office-level data, not pincode-level data.

Completeness / quality:

| Field / Measure | Count |
|---|---:|
| Total rows | 165,627 |
| Distinct pincodes | 19,586 |
| Missing `pincode` | 0 |
| Missing `officename` | 0 |
| Missing `district` | 0 |
| Missing `statename` | 0 |
| Missing latitude | 12,007 |
| Missing longitude | 12,002 |
| Non-numeric latitude | 12,013 |
| Non-numeric longitude | 12,008 |
| Coordinates outside India bounding box | 2,602 |

### Identifier Quality

`pincode` is not a unique identifier in this table. Some pincodes map to many post offices:

- `791122`: 153 post-office rows
- `791118`: 149 rows
- `345001`: 119 rows
- `494450`: 102 rows

For post-office-level identity, use a composite key:

`pincode + officename + district + statename`

There are still 10 duplicate rows at that composite grain, so exact de-duplication is needed.

## NFHS-5 District Health Indicators

### Completeness

The table has 706 rows. Core keys and survey counts have no SQL nulls:

- `district_name`: 0 missing
- `state_ut`: 0 missing
- `households_surveyed`: 0 missing
- `women_15_49_interviewed`: 0 missing
- `men_15_54_interviewed`: 0 missing

### Identifier Quality

`district_name + state_ut` is unique:

- Total rows: 706
- Distinct `district_name + state_ut`: 706

`district_name` alone is not unique:

- Distinct district names alone: 698
- Examples appearing in multiple states:
  - Aurangabad: Bihar, Maharastra
  - Balrampur: Chhattisgarh, Uttar Pradesh
  - Bijapur: Chhattisgarh, Karnataka
  - Bilaspur: Chhattisgarh, Himachal Pradesh
  - Hamirpur: Himachal Pradesh, Uttar Pradesh

Use state plus district for joins. Do not join on district name alone.

### Semantic Missingness and Suppression

NFHS has no SQL nulls in the profiled indicators, but several fields use `*` as a suppression/missing marker. Some values are also parenthesized, which appears to represent small-denominator estimates rather than normal numeric values.

High-suppression columns:

| Column | `*` Suppressed Count | Parenthesized Count |
|---|---:|---:|
| `non_breastfeeding_child_6_23m_receiving_an_adequate_diet16_pct` | 643 | 59 |
| `child_6_8m_receiving_solid_or_semi_solid_food_and_breastmil_pct` | 642 | 62 |
| `children_with_diarrhoea_2wk_who_received_oral_rehydration_s_pct` | 492 | 162 |
| `children_with_diarrhoea_2wk_who_received_zinc_child_u5_pct` | 492 | 162 |
| `children_with_diarrhoea_2wk_taken_to_a_health_facility_or_h_pct` | 492 | 162 |
| `children_born_at_home_who_were_taken_to_a_health_facility_f_pct` | 422 | 141 |
| `child_u6m_exclusively_breastfed_pct` | 261 | 347 |
| `pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct` | 134 | 421 |

Recommendation: convert `*` to null with a suppression flag, and parse parenthesized values into numeric values with a `small_sample_flag`.

## Recommended Third-Party / External Enrichment Sources

### Facility Identity, Contact, and Geocoding

Recommended sources:

- ABDM / National Health Authority Health Facility Registry, where accessible.
- Overture Maps Places for open POI identity and coordinates.
- OpenStreetMap for facility name/location/address enrichment.
- Commercial sources such as Google Places or Mappls, if licensing permits.
- Facility websites and social URLs already present in `source_urls`.

Useful enrichments:

- Facility name standardization.
- Verified coordinates.
- Phone number and website validation.
- Facility type and ownership/operator classification.
- Deduplication evidence from external POI IDs.

### Postal / Pincode Enrichment

Recommended sources:

- India Post official pincode tools.
- Government open-data sources such as Data.gov.in.
- DIGIPIN / Digital Postal Index Number where fine-grained location encoding is available.

Useful enrichments:

- Normalize pincodes to 6-digit strings.
- Validate state/district by pincode.
- Fill missing city/state/pincode where facility address is partially present.
- Replace bad facility coordinates with pincode centroid or post-office coordinates only as a fallback, with lower precision flags.

### NFHS Validation

Recommended sources:

- Official NFHS-5 / DHS district factsheets and source tables.
- Ministry of Health and Family Welfare / IIPS NFHS releases.

Useful enrichments:

- Confirm definitions of `*` suppression and parenthesized values.
- Add survey year/phase metadata.
- Add district/state codes if available.
- Add district boundary or census district identifiers for reliable geospatial joins.

## Recommended ID Strategy

### Facilities

Create two identifiers:

1. `facility_record_id`
   - Purpose: stable source-row identifier.
   - Suggested logic:
     - Use `unique_id` if present and unique after de-duplication.
     - Otherwise hash source lineage fields:
       - `source_content_id`
       - `content_table_id`
       - `source_ids`
       - `source_urls`

2. `facility_entity_id`
   - Purpose: deduplicated real-world facility identifier.
   - Suggested deterministic seed:
     - normalized facility name
     - normalized six-digit pincode
     - normalized city/state
     - rounded coordinates, if valid
   - Suggested hash:
     - `sha2(lower(trim(name)) || '|' || norm_pincode || '|' || norm_city || '|' || norm_state || '|' || rounded_lat || '|' || rounded_lon, 256)`
   - Then use fuzzy matching for unresolved cases:
     - name similarity
     - pincode / city / state agreement
     - distance threshold for valid coordinates
     - phone / website overlap
     - source URL overlap

### India Post Pincode Directory

Use two grains:

1. Post-office grain:
   - `post_office_id = sha2(pincode || officename || district || statename, 256)`

2. Pincode grain:
   - Create a curated pincode dimension with one row per pincode:
     - `pincode`
     - canonical state(s)
     - canonical district(s)
     - post office count
     - centroid coordinates if reliable
     - quality flags for multi-district or missing geocode cases

### NFHS

Use:

`district_health_id = sha2(lower(trim(state_ut)) || '|' || lower(trim(district_name)), 256)`

Also add:

- normalized state name
- normalized district name
- optional official district/state code if sourced externally

## Suggested Next Steps

1. Create curated bronze/silver views:
   - `facilities_clean`
   - `facilities_dedup_candidates`
   - `pincode_post_offices_clean`
   - `pincode_dimension`
   - `nfhs_district_indicators_clean`

2. Add explicit quality flags:
   - `is_missing_core_address`
   - `is_invalid_coordinate`
   - `is_duplicate_unique_id`
   - `is_possible_duplicate_entity`
   - `is_suppressed_value`
   - `is_small_sample_value`

3. Normalize and parse data types:
   - Convert numeric strings to numeric values.
   - Parse JSON-like arrays in fields such as `websites`, `phone_numbers`, `specialties`, `procedure`, `equipment`, and `capability`.
   - Convert `*` to null in NFHS indicators, with a separate suppression flag.
   - Strip parentheses from NFHS small-sample values into numeric values, with a separate flag.

4. Build a deduplication pipeline for facilities:
   - Exact duplicate removal.
   - Deterministic blocking by pincode/city/state.
   - Fuzzy name matching.
   - Coordinate-distance checks.
   - Human-review queue for uncertain matches.

5. Enrich missing and suspicious facility fields:
   - Pincode directory for address validation.
   - Overture/OpenStreetMap/ABDM or commercial POI sources for identity and geocoding.
   - Official NFHS sources for district metadata and survey footnotes.
