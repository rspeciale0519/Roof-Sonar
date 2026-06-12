-- The Villages expansion: seed Sumter / Lake / Marion jurisdictions. County
-- CHECK already allows these (migration 0007). The Villages itself is CDDs in
-- unincorporated Sumter/Lake/Marion + parts of Wildwood/Lady Lake, so the
-- postal city "THE VILLAGES" maps to each county's -county (unincorp) fallback;
-- incorporated cities get their own slug. Adapter notes record the source.

insert into jurisdictions (slug, name, county, adapter_type, notes) values
  -- Sumter (Villages core)
  ('sumter-county',     'Sumter County (unincorp.)',       'Sumter', 'api',  'Sumter AGOL Parcels_gdb; permits via NextRequest Citizenserve'),
  ('wildwood',          'City of Wildwood',                'Sumter', 'api',  'most new Villages south of SR 44; Wildwood CivicGov permits'),
  ('bushnell',          'City of Bushnell',                'Sumter', 'api',  'Sumter AGOL Parcels_gdb'),
  ('center-hill',       'City of Center Hill',             'Sumter', 'api',  'Sumter AGOL Parcels_gdb'),
  ('coleman',           'City of Coleman',                 'Sumter', 'api',  'Sumter AGOL Parcels_gdb'),
  ('webster',           'City of Webster',                 'Sumter', 'api',  'Sumter AGOL Parcels_gdb'),
  -- Lake (Lady Lake / Fruitland Park Villages + the rest of the county)
  ('lake-county',       'Lake County (unincorp.)',         'Lake',   'file', 'Lake PA monthly FTP; permits BPE_* extract pending'),
  ('lady-lake',         'Town of Lady Lake',               'Lake',   'file', 'Villages north; Lady Lake Citizenserve permits'),
  ('fruitland-park',    'City of Fruitland Park',          'Lake',   'file', 'Lake PA FTP'),
  ('leesburg',          'City of Leesburg',                'Lake',   'file', 'Lake PA FTP'),
  ('tavares',           'City of Tavares',                 'Lake',   'file', 'Lake PA FTP'),
  ('mount-dora',        'City of Mount Dora',              'Lake',   'file', 'Lake PA FTP'),
  ('eustis',            'City of Eustis',                  'Lake',   'file', 'Lake PA FTP'),
  ('clermont',          'City of Clermont',                'Lake',   'file', 'Lake PA FTP'),
  ('minneola',          'City of Minneola',                'Lake',   'file', 'Lake PA FTP'),
  ('groveland',         'City of Groveland',               'Lake',   'file', 'Lake PA FTP'),
  ('mascotte',          'City of Mascotte',                'Lake',   'file', 'Lake PA FTP'),
  ('montverde',         'Town of Montverde',               'Lake',   'file', 'Lake PA FTP'),
  ('astatula',          'Town of Astatula',                'Lake',   'file', 'Lake PA FTP'),
  ('howey-in-the-hills','Town of Howey-in-the-Hills',      'Lake',   'file', 'Lake PA FTP'),
  ('umatilla',          'City of Umatilla',                'Lake',   'file', 'Lake PA FTP'),
  -- Marion (newest Villages, south Marion)
  ('marion-county',     'Marion County (unincorp.)',       'Marion', 'scrape','MCPA_Data.ZIP parcels; CDPlus roof permits'),
  ('ocala',             'City of Ocala',                   'Marion', 'scrape','MCPA_Data.ZIP'),
  ('belleview',         'City of Belleview',               'Marion', 'scrape','MCPA_Data.ZIP'),
  ('dunnellon',         'City of Dunnellon',               'Marion', 'scrape','MCPA_Data.ZIP'),
  ('mcintosh',          'Town of McIntosh',                'Marion', 'scrape','MCPA_Data.ZIP'),
  ('reddick',           'Town of Reddick',                 'Marion', 'scrape','MCPA_Data.ZIP')
on conflict (slug) do nothing;
