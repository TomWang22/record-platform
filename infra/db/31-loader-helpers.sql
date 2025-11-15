SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'kind_info' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.kind_info AS (
      kind text,
      size_inch integer,
      speed_rpm integer,
      format_hint text
    );
  END IF;
END$$;

DROP FUNCTION IF EXISTS public.normalize_grade_loose(text);
CREATE OR REPLACE FUNCTION public.normalize_grade_loose(in_text text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  s text;
  canonical constant text[] := ARRAY[
    'M','NM','NM-','EX+','EX','EX-','VG+','VG','VG-','G+','G','G-','F','P'
  ];
BEGIN
  IF in_text IS NULL OR btrim(in_text) = '' THEN
    RETURN NULL;
  END IF;

  s := upper(in_text);
  s := regexp_replace(s, '[._]', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);
  s := regexp_replace(s, '\bPLUS\b', '+', 'g');
  s := regexp_replace(s, '\bMINUS\b', '-', 'g');
  s := regexp_replace(s, '\bNEAR\s+MINT\b', 'NM', 'g');
  s := regexp_replace(s, '\bMINT\s*-\b', 'NM', 'g');
  s := regexp_replace(s, '\bEXCELLENT\b', 'EX', 'g');
  s := regexp_replace(s, '\bVERY\s+GOOD\b', 'VG', 'g');
  s := regexp_replace(s, '\bGOOD\b', 'G', 'g');
  s := regexp_replace(s, '\bFAIR\b', 'F', 'g');
  s := regexp_replace(s, '\bPOOR\b', 'P', 'g');
  s := regexp_replace(s, '\s+', '', 'g');

  s := regexp_replace(s, '^VGPLUS$', 'VG+', 'g');
  s := regexp_replace(s, '^VGMINUS$', 'VG-', 'g');
  s := regexp_replace(s, '^EXPLUS$', 'EX+', 'g');
  s := regexp_replace(s, '^EXMINUS$', 'EX-', 'g');
  s := regexp_replace(s, '^NMPLUS$', 'NM+', 'g');
  s := regexp_replace(s, '^NMMINUS$', 'NM-', 'g');

  IF s = 'NM+' THEN
    s := 'NM'; -- treat NM+ as NM to stay within canonical set
  END IF;

  IF s = ANY(canonical) THEN
    RETURN s;
  END IF;

  IF s ~ '^(M|NM|EX|VG|G|F|P)(\+|-)?$' THEN
    IF s = 'NM+' THEN
      RETURN 'NM';
    ELSIF s = 'M+' THEN
      RETURN 'M';
    ELSIF s = 'M-' THEN
      RETURN 'NM';
    ELSE
      IF array_position(canonical, s) IS NOT NULL THEN
        RETURN s;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.derive_kind_and_hints(text);
CREATE OR REPLACE FUNCTION public.derive_kind_and_hints(in_text text)
RETURNS public.kind_info
LANGUAGE plpgsql
AS $$
DECLARE
  raw text := COALESCE(in_text, '');
  s   text := upper(btrim(raw));
  kind text := 'OTHER';
  size integer := NULL;
  speed integer := NULL;
  hint text := NULL;
BEGIN
  IF s ~ '(VINYL|RECORD|LP|12"|12IN|12-?INCH|12 IN)' THEN
    kind := 'VINYL';
    size := 12;
    speed := 33;
  ELSIF s ~ '(10"|10IN|10-?INCH|10 IN)' THEN
    kind := 'VINYL';
    size := 10;
    speed := 33;
  ELSIF s ~ '(7"|7IN|7-?INCH|7 IN|EP|45)' THEN
    kind := 'VINYL';
    size := 7;
    speed := 45;
    hint := 'EP';
  ELSIF s ~ '^(CD|COMPACT\s*DISC)$' THEN
    kind := 'CD';
  ELSIF s ~ '^(CASSETTE|TAPE)$' THEN
    kind := 'CASSETTE';
  END IF;

  RETURN (kind, size, speed, hint);
END;
$$;

SET search_path = records;

CREATE TABLE IF NOT EXISTS records.record_media (
  record_id UUID REFERENCES records.records(id) ON DELETE CASCADE,
  index integer NOT NULL,
  kind text,
  size_inch integer,
  speed_rpm integer,
  PRIMARY KEY (record_id, index)
);

