-- Tampa Bay + Villages expansion: allow the new counties and seed Pinellas
-- jurisdictions (PA bulk feed covers all 24 in one file; slugs match
-- RP_PERMITS AGENCY_NAME mapping in scripts/ingest-pinellas.ts).

alter table jurisdictions drop constraint if exists jurisdictions_county_check;
alter table jurisdictions add constraint jurisdictions_county_check
  check (county in ('Seminole', 'Volusia', 'Orange',
                    'Pinellas', 'Hillsborough', 'Pasco',
                    'Sumter', 'Lake', 'Marion'));

alter table address_points drop constraint if exists address_points_county_check;
alter table address_points add constraint address_points_county_check
  check (county in ('Seminole', 'Volusia', 'Orange',
                    'Pinellas', 'Hillsborough', 'Pasco',
                    'Sumter', 'Lake', 'Marion'));

insert into jurisdictions (slug, name, county, adapter_type, notes) values
  ('pinellas-county',       'Pinellas County (unincorp.)',     'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('st-petersburg',         'City of St. Petersburg',          'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('clearwater',            'City of Clearwater',              'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('largo',                 'City of Largo',                   'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('pinellas-park',         'City of Pinellas Park',           'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('dunedin',               'City of Dunedin',                 'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('tarpon-springs',        'City of Tarpon Springs',          'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('st-pete-beach',         'City of St. Pete Beach',          'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('treasure-island',       'City of Treasure Island',         'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('gulfport',              'City of Gulfport',                'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('seminole-city',         'City of Seminole',                'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed; slug avoids clash with seminole-county'),
  ('safety-harbor',         'City of Safety Harbor',           'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('oldsmar',               'City of Oldsmar',                 'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('madeira-beach',         'City of Madeira Beach',           'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('belleair',              'Town of Belleair',                'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('south-pasadena',        'City of South Pasadena',          'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('redington-shores',      'Town of Redington Shores',        'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('indian-rocks-beach',    'City of Indian Rocks Beach',      'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('indian-shores',         'Town of Indian Shores',           'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('kenneth-city',          'Town of Kenneth City',            'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('redington-beach',       'Town of Redington Beach',         'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('north-redington-beach', 'Town of North Redington Beach',   'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('belleair-beach',        'City of Belleair Beach',          'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed'),
  ('belleair-bluffs',       'City of Belleair Bluffs',         'Pinellas', 'file', 'PCPAO nightly RP_PERMITS feed')
on conflict (slug) do nothing;
