-- Tampa Bay expansion: seed Hillsborough + Pasco jurisdictions. County CHECK
-- already allows both (migration 0007). Big unincorporated postal areas
-- (Wesley Chapel, Land O' Lakes, Brandon, Riverview…) map to the -county
-- (unincorp.) fallback; incorporated municipalities get their own slug.

insert into jurisdictions (slug, name, county, adapter_type, notes) values
  -- Pasco
  ('pasco-county',     'Pasco County (unincorp.)',     'Pasco', 'file', 'PascoPA FTP parcel_summary; coords PascoMapper_Addresses; Accela permits'),
  ('dade-city',        'City of Dade City',            'Pasco', 'file', 'PascoPA FTP'),
  ('new-port-richey',  'City of New Port Richey',      'Pasco', 'file', 'PascoPA FTP'),
  ('port-richey',      'City of Port Richey',          'Pasco', 'file', 'PascoPA FTP'),
  ('zephyrhills',      'City of Zephyrhills',          'Pasco', 'file', 'PascoPA FTP'),
  ('san-antonio',      'City of San Antonio',          'Pasco', 'file', 'PascoPA FTP'),
  ('st-leo',           'Town of St. Leo',              'Pasco', 'file', 'PascoPA FTP'),
  -- Hillsborough
  ('hillsborough-county','Hillsborough County (unincorp.)','Hillsborough', 'file', 'HCPA parcels; coords LatLon_Table; HillsGovHub/Accela permits'),
  ('tampa',            'City of Tampa',                'Hillsborough', 'file', 'HCPA parcels; Tampa CivicData permits'),
  ('temple-terrace',   'City of Temple Terrace',       'Hillsborough', 'file', 'HCPA parcels'),
  ('plant-city',       'City of Plant City',           'Hillsborough', 'file', 'HCPA parcels')
on conflict (slug) do nothing;
