--
-- PostgreSQL database dump
--

\restrict CtZBXEIauv3FPcDpbFewDglcDmobLf7cBwvIxHaFyjq5c7cYLryw3o6WioktEqa

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: records; Type: SCHEMA; Schema: -; Owner: record_owner
--

CREATE SCHEMA records;


ALTER SCHEMA records OWNER TO record_owner;

--
-- Name: records_hot_iso; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA records_hot_iso;


ALTER SCHEMA records_hot_iso OWNER TO postgres;

--
-- Name: _hot_records_rel(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public._hot_records_rel() RETURNS regclass
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
           to_regclass('records_poc.records'),
           to_regclass('records.records')
         )
$$;


ALTER FUNCTION public._hot_records_rel() OWNER TO postgres;

--
-- Name: _hot_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public._hot_user() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT id FROM auth.users ORDER BY email NULLS LAST, id LIMIT 1 $$;


ALTER FUNCTION public._hot_user() OWNER TO postgres;

--
-- Name: choice(anyarray); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.choice(anyarray) RETURNS anyelement
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  SELECT $1[1 + floor(random()*array_length($1,1))::int]
$_$;


ALTER FUNCTION public.choice(anyarray) OWNER TO postgres;

--
-- Name: norm_text(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.norm_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;


ALTER FUNCTION public.norm_text(t text) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: records; Type: TABLE; Schema: records; Owner: record_owner
--

CREATE TABLE records.records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    artist text NOT NULL,
    name text NOT NULL,
    format text NOT NULL,
    catalog_number text,
    record_grade text,
    sleeve_grade text,
    has_insert boolean DEFAULT false,
    has_booklet boolean DEFAULT false,
    has_obi_strip boolean DEFAULT false,
    has_factory_sleeve boolean DEFAULT false,
    is_promo boolean DEFAULT false,
    notes text,
    purchased_at date,
    price_paid numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    insert_grade text,
    booklet_grade text,
    obi_strip_grade text,
    factory_sleeve_grade text,
    release_year integer,
    release_date date,
    pressing_year integer,
    label text,
    label_code text,
    artist_norm text,
    name_norm text,
    label_norm text,
    catalog_norm text,
    search_norm text
)
WITH (autovacuum_analyze_threshold='1000', autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.05', autovacuum_vacuum_threshold='1000', autovacuum_vacuum_cost_limit='4000', autovacuum_vacuum_cost_delay='0', toast.autovacuum_vacuum_scale_factor='0.01', toast.autovacuum_vacuum_threshold='1000', toast.autovacuum_vacuum_cost_limit='2000', toast.autovacuum_vacuum_cost_delay='2');


ALTER TABLE records.records OWNER TO record_owner;

--
-- Name: records_recent(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.records_recent(p_user uuid, p_limit integer DEFAULT 50) RETURNS SETOF records.records
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT *
  FROM records.records
  WHERE user_id = p_user
  ORDER BY updated_at DESC
  LIMIT GREATEST(1, LEAST(200, COALESCE(p_limit,50)));
$$;


ALTER FUNCTION public.records_recent(p_user uuid, p_limit integer) OWNER TO postgres;

--
-- Name: search_autocomplete(uuid, text, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_autocomplete(p_user uuid, p_q text, p_k integer DEFAULT 10, p_field text DEFAULT 'artist'::text) RETURNS TABLE(term text, hits integer, dist real)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  WITH p AS (
    SELECT norm_text(COALESCE(p_q,'')) AS qn,
           CASE WHEN p_field IN ('label','catalog') THEN p_field ELSE 'artist' END AS fld
  ),
  base AS (
    SELECT CASE
             WHEN (SELECT fld FROM p)='label'   THEN r.label
             WHEN (SELECT fld FROM p)='catalog' THEN r.catalog_number
             ELSE r.artist
           END AS term_raw,
           CASE
             WHEN (SELECT fld FROM p)='label'   THEN r.label_norm
             WHEN (SELECT fld FROM p)='catalog' THEN r.catalog_norm
             ELSE r.artist_norm
           END AS term_norm
    FROM records.records r
    WHERE r.user_id = p_user
  ),
  alias AS (
    SELECT NULL::text AS term_raw, a.alias_norm AS term_norm
    FROM records.aliases_mv a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
  ),
  unioned AS (SELECT * FROM base UNION ALL SELECT * FROM alias)
  SELECT COALESCE(term_raw, term_norm) AS term,
         COUNT(*)::int AS hits,
         MIN(similarity(term_norm, (SELECT qn FROM p))) AS dist
  FROM unioned
  WHERE term_norm IS NOT NULL AND term_norm <> ''
    AND (
      (length((SELECT qn FROM p)) <= 2 AND term_norm LIKE (SELECT qn FROM p) || '%') OR
      (length((SELECT qn FROM p)) >  2 AND term_norm %   (SELECT qn FROM p))
    )
  GROUP BY 1
  ORDER BY dist DESC, hits DESC
  LIMIT LEAST(50, GREATEST(1, p_k));
$$;


ALTER FUNCTION public.search_autocomplete(p_user uuid, p_q text, p_k integer, p_field text) OWNER TO postgres;

--
-- Name: search_facets(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_facets(p_user uuid, p_q text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE qn TEXT := norm_text(p_q);
BEGIN
  RETURN jsonb_build_object(
    'format', (
      SELECT jsonb_agg(jsonb_build_object('format',format,'count',cnt) ORDER BY cnt DESC)
      FROM (
        SELECT format, COUNT(*) AS cnt
        FROM records.records r
        WHERE r.user_id=p_user
          AND ((length(qn)<=2 AND r.search_norm LIKE qn||'%')
            OR (length(qn)>2  AND r.search_norm % qn))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20
      ) t
    ),
    'label', (
      SELECT jsonb_agg(jsonb_build_object('label',label,'count',cnt) ORDER BY cnt DESC)
      FROM (
        SELECT label, COUNT(*) AS cnt
        FROM records.records r
        WHERE r.user_id=p_user AND label IS NOT NULL AND label<>''
          AND ((length(qn)<=2 AND r.label_norm LIKE qn||'%')
            OR (length(qn)>2  AND r.label_norm % qn))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20
      ) t
    ),
    'year', (
      SELECT jsonb_agg(
               jsonb_build_object('bucket',
                 CASE
                   WHEN release_year BETWEEN 1970 AND 1979 THEN '70s'
                   WHEN release_year BETWEEN 1980 AND 1989 THEN '80s'
                   WHEN release_year BETWEEN 1990 AND 1999 THEN '90s'
                   WHEN release_year BETWEEN 2000 AND 2009 THEN '00s'
                   WHEN release_year BETWEEN 2010 AND 2019 THEN '10s'
                   WHEN release_year BETWEEN 2020 AND 2029 THEN '20s'
                   ELSE 'unknown'
                 END,
                 'count',cnt) ORDER BY cnt DESC)
      FROM (
        SELECT release_year, COUNT(*) AS cnt
        FROM records.records r
        WHERE r.user_id=p_user AND release_year IS NOT NULL
          AND ((length(qn)<=2 AND r.search_norm LIKE qn||'%')
            OR (length(qn)>2  AND r.search_norm % qn))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20
      ) t
    )
  );
END;
$$;


ALTER FUNCTION public.search_facets(p_user uuid, p_q text) OWNER TO postgres;

--
-- Name: search_hot_0dc2_cap800_s062(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_0dc2_cap800_s062(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET gin_fuzzy_search_limit TO '800'
    SET "pg_trgm.similarity_threshold" TO '0.62'
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    AS $$
WITH x AS (
  SELECT public.norm_text(coalesce(p_q, '')) AS q
),
cand AS (
  SELECT r.id
  FROM records_poc.records r, x
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND r.search_norm % x.q
  LIMIT 800
)
SELECT r.id::uuid AS id,
       (1::real - (r.search_norm <-> x.q)::real) AS rank
FROM cand c
JOIN records_poc.records r ON r.id = c.id
CROSS JOIN x
ORDER BY r.search_norm <-> x.q
LIMIT GREATEST(1, LEAST(1000, p_limit))
OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_hot_0dc2_cap800_s062(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_0dc2_knn_only(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_0dc2_knn_only(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    AS $$
WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
SELECT r.id::uuid AS id,
       (1::real - (r.search_norm <-> x.q)::real) AS rank
FROM records_poc.records r, x
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
ORDER BY r.search_norm <-> x.q
LIMIT GREATEST(1, LEAST(1000, p_limit))
OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_hot_0dc2_knn_only(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_c25_s032(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_c25_s032(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '65536'
    SET random_page_cost TO '1.0'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET enable_indexscan TO 'on'
    AS $$
WITH x AS (SELECT norm_text(coalesce(p_q, '')) AS q),
     base AS (
       -- small KNN shortlist from GiST on the tiny ISO table
       SELECT h.id, (h.search_norm <-> x.q) AS dist
       FROM   records_hot_iso.records_hot_0dc2 h, x
       ORDER  BY 2
       LIMIT  LEAST(300, GREATEST(100, p_limit*6))
     ),
     ranked AS (
       -- OPTIONAL: compute similarity only for the shortlist (heap touch on shortlist only)
       SELECT b.id, b.dist, similarity(h.search_norm, x.q) AS sim
       FROM   base b
       JOIN   records_hot_iso.records_hot_0dc2 h ON h.id = b.id, x
     )
SELECT id,
       (1.0/(1.0+dist))::real AS rank
FROM   ranked
-- If you want a similarity gate, uncomment next line:
-- WHERE  sim >= current_setting('pg_trgm.similarity_threshold')::float
ORDER  BY dist ASC
LIMIT  GREATEST(1, LEAST(1000, p_limit))
OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_hot_c25_s032(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_c25_s032_knn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_c25_s032_knn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '65536'
    SET random_page_cost TO '1.0'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET enable_indexscan TO 'on'
    AS $$
WITH x AS (SELECT norm_text(coalesce(p_q, '')) AS q)
SELECT h.id,
       (1.0/(1.0 + (h.search_norm <-> x.q)))::real AS rank
FROM   records_hot_iso.records_hot_0dc2 h, x
ORDER  BY h.search_norm <-> x.q
LIMIT  GREATEST(1, LEAST(1000, p_limit))
OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_hot_c25_s032_knn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_hot_percent_then_knn_adapt(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_hot_percent_then_knn_adapt(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'on'
    SET random_page_cost TO '1.0'
    SET work_mem TO '64MB'
    AS $_$
DECLARE
  gates numeric[] := ARRAY[0.60,0.58,0.56,0.54,0.52,0.50,0.48,0.46];
  gate  numeric;
  sql   text;
  body  text := $q$
    WITH x AS (
      SELECT set_limit($GATE$) AS _ , public.norm_text(coalesce($1,'')) AS q
    ),
    cand AS (
      SELECT h.id, (h.search_norm <-> x.q) AS dist
      FROM records_hot.records_hot h, x
      WHERE h.user_id = $USER$::uuid
        AND h.search_norm % x.q
        AND similarity(h.search_norm, x.q) >= $GATE$
      ORDER BY 1 ASC
      LIMIT LEAST(600, GREATEST(200, $2*12))
    )
    SELECT id, (1::real - dist::real) AS rank
    FROM cand
    ORDER BY dist ASC
    LIMIT GREATEST(1, LEAST(1000, $2))
    OFFSET GREATEST(0, $3)
  $q$;
BEGIN
  FOREACH gate IN ARRAY gates LOOP
    sql := replace(body, '$USER$', quote_literal(p_user));
    sql := replace(sql, '$GATE$', to_char(gate,'FM0.00'));
    RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
    IF FOUND THEN RETURN; END IF;
  END LOOP;

  -- Final fallback: your existing pure KNN wrapper (hot heap)
  RETURN QUERY
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT h.id, (1::real - (h.search_norm <-> x.q)::real) AS rank
  FROM records_hot.records_hot h, x
  WHERE h.user_id = p_user
  ORDER BY h.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset);
END
$_$;


ALTER FUNCTION public.search_hot_hot_percent_then_knn_adapt(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_knn_only(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_knn_only(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    SET random_page_cost TO '1.0'
    AS $$
DECLARE
  use_hot boolean;
BEGIN
  use_hot := (to_regclass('records_hot.records_hot') IS NOT NULL)
             AND EXISTS (SELECT 1 FROM records_hot.records_hot WHERE user_id = p_user LIMIT 1);

  IF use_hot THEN
    RETURN QUERY
    WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
    SELECT h.id, (1::real - (h.search_norm <-> x.q)::real) AS rank
    FROM records_hot.records_hot h, x
    WHERE h.user_id = p_user
    ORDER BY h.search_norm <-> x.q
    LIMIT GREATEST(1, LEAST(1000, p_limit))
    OFFSET GREATEST(0, p_offset);
  ELSE
    RETURN QUERY
    WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
    SELECT r.id, (1::real - (r.search_norm <-> x.q)::real) AS rank
    FROM records.records r, x
    WHERE r.user_id = p_user
    ORDER BY r.search_norm <-> x.q
    LIMIT GREATEST(1, LEAST(1000, p_limit))
    OFFSET GREATEST(0, p_offset);
  END IF;
END
$$;


ALTER FUNCTION public.search_hot_knn_only(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s032(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s032(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET random_page_cost TO '1.1'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records.records r, x
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND r.search_norm % x.q
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s032(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s032_fast(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s032_fast(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q),
  cand AS (
    SELECT r.id, similarity(r.search_norm, x.q) AS sim
    FROM records.records r, x
    WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid     -- tenant-pinned
      AND r.search_norm % x.q                  -- hits GIN
    ORDER BY sim DESC
    LIMIT LEAST(1000, GREATEST(100, p_limit*20))  -- shortlist ~20× limit
  )
  SELECT id, sim::real AS rank
  FROM cand
  ORDER BY sim DESC
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s032_fast(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s032_gin_then_knn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s032_gin_then_knn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q),
  cand AS (
    SELECT r.id,
           similarity(r.search_norm, x.q) AS sim,
           (r.search_norm <-> x.q)        AS dist
    FROM records.records r, x
    WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND r.search_norm % x.q
    ORDER BY sim DESC
    LIMIT LEAST(1000, GREATEST(100, p_limit*20))
  )
  SELECT id, (1::real - dist::real) AS rank
  FROM cand
  ORDER BY dist ASC                  -- KNN tie-break over shortlist
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s032_gin_then_knn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s032_knn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s032_knn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET random_page_cost TO '1.1'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records.records r, x
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s032_knn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s036_fast(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s036_fast(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.36'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q),
  cand AS (
    SELECT r.id, similarity(r.search_norm, x.q) AS sim
    FROM records.records r, x
    WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND r.search_norm % x.q
    ORDER BY sim DESC
    LIMIT LEAST(1000, GREATEST(300, p_limit*12))
  )
  SELECT id, sim::real AS rank
  FROM cand
  ORDER BY sim DESC
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s036_fast(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_main_c25_s036_gin_then_knn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_main_c25_s036_gin_then_knn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.36'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q),
  cand AS (
    SELECT r.id, (r.search_norm <-> x.q) AS dist
    FROM records.records r, x
    WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND r.search_norm % x.q
    ORDER BY 1 ASC
    LIMIT LEAST(1000, GREATEST(300, p_limit*12))
  )
  SELECT id, (1::real - dist::real) AS rank
  FROM cand
  ORDER BY dist ASC
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_main_c25_s036_gin_then_knn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_official(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official(p_q text, p_limit integer, p_offset integer) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET "pg_trgm.similarity_threshold" TO '0.42'
    SET gin_fuzzy_search_limit TO '300'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q, '')) AS q),
  cand AS (
    SELECT h.id,
           (h.search_norm <-> x.q) AS dist
    FROM records_hot.records_hot h, x
    WHERE h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND h.search_norm % x.q
    ORDER BY (h.search_norm <-> x.q) ASC
    LIMIT LEAST(400, GREATEST(200, p_limit*8))
  )
  SELECT id, (1::real - dist::real) AS rank
  FROM cand
  -- already ordered by dist ASC; omit outer ORDER BY to avoid re-sort
  LIMIT  GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_official(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_count(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_count(p_q text, p_limit integer, p_offset integer) RETURNS integer
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET "pg_trgm.similarity_threshold" TO '0.42'
    SET gin_fuzzy_search_limit TO '300'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q, '')) AS q),
  cand AS (
    SELECT h.id,
           (h.search_norm <-> x.q) AS dist
    FROM records_hot.records_hot h, x
    WHERE h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND h.search_norm % x.q
    ORDER BY (h.search_norm <-> x.q) ASC
    LIMIT LEAST(400, GREATEST(200, p_limit*8))
  )
  SELECT count(*)
  FROM (
    SELECT id
    FROM cand
    -- already KNN-ordered; just respect limit/offset
    LIMIT  GREATEST(1, LEAST(1000, p_limit))
    OFFSET GREATEST(0, p_offset)
  ) s
$$;


ALTER FUNCTION public.search_hot_official_count(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_count_norm(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_count_norm(p_q_norm text, p_limit integer, p_offset integer) RETURNS integer
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    SET enable_seqscan TO 'off'
    SET enable_indexscan TO 'off'
    SET enable_bitmapscan TO 'on'
    SET "pg_trgm.similarity_threshold" TO '0.40'
    SET gin_fuzzy_search_limit TO '400'
    AS $$
  WITH x AS (SELECT coalesce(p_q_norm, '') AS q),
  cand AS (
    -- GIN % shortlist + ORDER BY similarity (cheap) + LIMIT
    SELECT h.id,
           similarity(h.search_norm, x.q) AS sim,
           (h.search_norm <-> x.q)        AS dist
    FROM records_hot_iso.records_hot_0dc2 h, x
    WHERE h.search_norm % x.q
    ORDER BY sim DESC
    LIMIT LEAST(300, GREATEST(150, p_limit*6))
  )
  SELECT count(*)
  FROM (
    -- final KNN reorder of tiny set
    SELECT id
    FROM cand
    ORDER BY dist ASC
    LIMIT  GREATEST(1, LEAST(1000, p_limit))
    OFFSET GREATEST(0, p_offset)
  ) s
$$;


ALTER FUNCTION public.search_hot_official_count_norm(p_q_norm text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_knn(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_knn(p_q text, p_limit integer, p_offset integer) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  SELECT * FROM public.search_hot_main_c25_s032_knn(p_q, p_limit, p_offset, false)
$$;


ALTER FUNCTION public.search_hot_official_knn(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_knn_count(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_knn_count(p_q text, p_limit integer, p_offset integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $$SELECT count(*) FROM public.search_hot_official_knn(p_q, p_limit, p_offset)$$;


ALTER FUNCTION public.search_hot_official_knn_count(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_norm(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_norm(p_q_norm text, p_limit integer, p_offset integer) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET "pg_trgm.similarity_threshold" TO '0.42'
    SET gin_fuzzy_search_limit TO '300'
    AS $$
  WITH x AS (SELECT coalesce(p_q_norm, '') AS q),
  cand AS (
    SELECT h.id, (h.search_norm <-> x.q) AS dist
    FROM records_hot.records_hot h, x
    WHERE h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
      AND h.search_norm % x.q
    ORDER BY (h.search_norm <-> x.q) ASC
    LIMIT LEAST(400, GREATEST(200, p_limit*8))
  )
  SELECT id, (1::real - dist::real) AS rank
  FROM cand
  LIMIT  GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_official_norm(p_q_norm text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_s032(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_s032(p_q text, p_limit integer, p_offset integer) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  SELECT * FROM public.search_hot_main_c25_s036_fast(p_q, p_limit, p_offset, false)
$$;


ALTER FUNCTION public.search_hot_official_s032(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_s032_count(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_s032_count(p_q text, p_limit integer, p_offset integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $$SELECT count(*) FROM public.search_hot_official_s032(p_q, p_limit, p_offset)$$;


ALTER FUNCTION public.search_hot_official_s032_count(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_official_super(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_official_super(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET gin_fuzzy_search_limit TO '800'
    SET "pg_trgm.similarity_threshold" TO '0.52'
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    AS $$
WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q),
caps AS (
  SELECT 800::int AS cap, 400::int AS half
),
trig AS (
  SELECT r.id, 1 AS src
  FROM records_poc.records r, x, caps
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND r.search_norm % x.q
  LIMIT (SELECT cap FROM caps)
),
ali AS (
  SELECT a.record_id AS id, 2 AS src
  FROM records.aliases_mv a, x, caps
  WHERE a.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND a.alias_norm % x.q
  LIMIT (SELECT half FROM caps)
),
ftsq AS (
  SELECT websearch_to_tsquery('simple', x.q) AS qts FROM x
),
fts AS (
  SELECT s.id, 3 AS src
  FROM records.search_doc_mv s, ftsq, caps
  WHERE s.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND s.sv @@ ftsq.qts
  ORDER BY ts_rank(s.sv, ftsq.qts) DESC
  LIMIT (SELECT half FROM caps)
),
bag AS (
  SELECT * FROM trig
  UNION ALL SELECT * FROM ali
  UNION ALL SELECT * FROM fts
),
cand AS MATERIALIZED (
  SELECT id,
         bool_or(src=2) AS hit_alias,
         bool_or(src=3) AS hit_fts
  FROM bag
  GROUP BY id
  LIMIT (SELECT cap FROM caps)
)
SELECT r.id::uuid AS id,
       ((1::real - (r.search_norm <-> x.q)::real)
           + CASE WHEN c.hit_alias THEN 0.02 ELSE 0 END
           + CASE WHEN c.hit_fts   THEN 0.04 ELSE 0 END)::real AS rank
FROM cand c
JOIN records_poc.records r USING (id)
CROSS JOIN x
ORDER BY r.search_norm <-> x.q
LIMIT GREATEST(1, LEAST(1000, p_limit))
OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_hot_official_super(p_q text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: search_hot_percent_then_knn(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_percent_then_knn(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $_$
DECLARE
  sql text;
BEGIN
  sql := $q$
    WITH x AS (SELECT public.norm_text(coalesce($1,'')) AS q),
    cand AS (
      SELECT r.id, (r.search_norm <-> x.q) AS dist
      FROM records.records r, x
      WHERE r.user_id = $USER_LIT$
        AND r.search_norm % x.q
      ORDER BY 1 ASC
      LIMIT LEAST(1000, GREATEST(300, $2*12))
    )
    SELECT id, (1::real - dist::real) AS rank
    FROM cand
    ORDER BY dist ASC
    LIMIT GREATEST(1, LEAST(1000, $2))
    OFFSET GREATEST(0, $3)
  $q$;

  sql := replace(sql, '$USER_LIT$', quote_literal(p_user) || '::uuid');

  RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
END
$_$;


ALTER FUNCTION public.search_hot_percent_then_knn(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_percent_then_knn_adapt(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_percent_then_knn_adapt(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET enable_seqscan TO 'off'
    SET enable_bitmapscan TO 'off'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $_$
DECLARE
  gates real[] := ARRAY[0.60, 0.58, 0.56, 0.54, 0.52];
  gate  real;
  cap   int := 400;   -- cap shortlist
  base  int := 10;    -- shortlist ≈ base×limit
  tname text;
  use_hot boolean;
  sql   text;
BEGIN
  use_hot := (to_regclass('records_hot.records_hot') IS NOT NULL)
             AND EXISTS (SELECT 1 FROM records_hot.records_hot WHERE user_id = p_user LIMIT 1);
  tname := CASE WHEN use_hot THEN 'records_hot.records_hot' ELSE 'records.records' END;

  FOREACH gate IN ARRAY gates LOOP
    sql := 'WITH x AS (
              SELECT set_limit($4) AS _, public.norm_text(coalesce($1, '''')) AS q
            ),
            cand AS (
              SELECT h.id, (h.search_norm <-> x.q) AS dist
              FROM '||tname||' h, x
              WHERE h.user_id = $5
                AND h.search_norm % x.q
                AND similarity(h.search_norm, x.q) >= $4
              ORDER BY 1 ASC
              LIMIT LEAST($6, GREATEST(200, $2*$7))
            )
            SELECT id, (1::real - dist::real) AS rank
            FROM cand
            ORDER BY dist ASC
            LIMIT GREATEST(1, LEAST(1000, $2))
            OFFSET GREATEST(0, $3)';

    RETURN QUERY EXECUTE sql USING
      p_q,           -- $1
      p_limit,       -- $2
      p_offset,      -- $3
      gate,          -- $4 (set_limit & similarity gate)
      p_user,        -- $5
      cap,           -- $6
      base;          -- $7

    IF FOUND THEN
      RETURN;
    END IF;
  END LOOP;

  -- last resort
  RETURN QUERY SELECT * FROM public.search_hot_knn_only(p_user, p_q, p_limit, p_offset, p_strict);
END
$_$;


ALTER FUNCTION public.search_hot_percent_then_knn_adapt(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_percent_then_knn_safe(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_percent_then_knn_safe(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $_$
DECLARE
  sql text;
  rows int;
BEGIN
  -- 1st pass: tighter shortlist
  sql := '
    WITH x AS (
      SELECT set_limit(0.52) AS _, public.norm_text(coalesce($1, '''')) AS q
    ),
    cand AS (
      SELECT r.id, (r.search_norm <-> x.q) AS dist
      FROM records.records r, x
      WHERE r.user_id = ' || quote_literal(p_user)::text || '::uuid
        AND r.search_norm % x.q
        AND similarity(r.search_norm, x.q) >= 0.52
      ORDER BY dist ASC
      LIMIT 400
    )
    SELECT id, (1::real - dist::real) AS rank
    FROM cand
    ORDER BY dist ASC
    LIMIT GREATEST(1, LEAST(1000, $2))
    OFFSET GREATEST(0, $3)
  ';
  RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
  GET DIAGNOSTICS rows = ROW_COUNT;

  IF rows = 0 THEN
    -- Fallback: slightly looser
    sql := replace(sql, '0.52', '0.50');
    RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
  END IF;
END
$_$;


ALTER FUNCTION public.search_hot_percent_then_knn_safe(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_poc_c25_s032(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_poc_c25_s032(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records_poc.records r, x
  WHERE r.search_norm % x.q
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_poc_c25_s032(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_hot_poc_c25_s032_knn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_hot_poc_c25_s032_knn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records_poc.records r, x
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset)
$$;


ALTER FUNCTION public.search_hot_poc_c25_s032_knn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint)
$$;


ALTER FUNCTION public.search_records_fuzzy_ids(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_core(uuid, text, bigint, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_core(p_user uuid, p_q text, p_limit bigint, p_offset bigint) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    AS $$
  WITH q AS (
    -- set_limit() both sets pg_trgm’s threshold and returns a real so we can SELECT it
    SELECT public.norm_text(p_q) AS qn,
           set_limit(0.25)       AS lim
  ),

  -- Candidates from records fields (looser threshold to widen recall)
  cand_from_records AS (
    SELECT r.id
    FROM records.records r, q
    WHERE r.user_id = p_user
      AND (
           similarity(r.search_norm, q.qn) >= 0.10
        OR similarity(r.artist_norm,  q.qn) >= 0.10
        OR similarity(r.name_norm,    q.qn) >= 0.10
        OR similarity(r.label_norm,   q.qn) >= 0.10
        OR similarity(r.catalog_norm, q.qn) >= 0.10
      )
  ),

  -- Candidates from aliases_mv (catch non-Latin variants)
  cand_from_aliases AS (
    SELECT a.record_id AS id
    FROM records.aliases_mv a, q
    WHERE a.user_id = p_user
      AND similarity(a.alias_norm, q.qn) >= 0.20
  ),

  cand AS (
    SELECT id FROM cand_from_records
    UNION
    SELECT id FROM cand_from_aliases
  ),

  scored AS (
    SELECT r.id,
           GREATEST(
             similarity(r.search_norm, q.qn),
             similarity(r.artist_norm,  q.qn),
             similarity(r.name_norm,    q.qn),
             similarity(r.label_norm,   q.qn),
             similarity(r.catalog_norm, q.qn),
             COALESCE(al.alias_sim, 0)
           )::real AS rank,
           r.search_norm <-> q.qn AS dist
    FROM cand c
    JOIN records.records r ON r.id = c.id
    CROSS JOIN q
    -- best alias match per record (if any)
    LEFT JOIN LATERAL (
      SELECT similarity(a2.alias_norm, q.qn) AS alias_sim
      FROM records.aliases_mv a2
      WHERE a2.user_id = p_user
        AND a2.record_id = r.id
      ORDER BY a2.alias_norm <-> q.qn
      LIMIT 1
    ) al ON true
  )

  SELECT id, rank
  FROM scored
  ORDER BY dist
  LIMIT p_limit OFFSET p_offset
$$;


ALTER FUNCTION public.search_records_fuzzy_ids_core(p_user uuid, p_q text, p_limit bigint, p_offset bigint) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_knn_bias(uuid, text, bigint, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_knn_bias(p_user uuid, p_q text, p_limit bigint, p_offset bigint) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit, p_offset)
$$;


ALTER FUNCTION public.search_records_fuzzy_ids_knn_bias(p_user uuid, p_q text, p_limit bigint, p_offset bigint) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    AS $$
  WITH x AS (
    SELECT norm_text(coalesce(p_q,'')) AS q,
           greatest(10, least(40, coalesce(current_setting('app.search.rec_cap', true)::int, 25))) AS cap,
           coalesce(current_setting('app.search.dist_cutoff', true)::float, 0.86) AS dcut
  ),
  base AS (
    SELECT r.id::uuid AS id,
           (r.search_norm <-> x.q) AS d
    FROM records_poc.records r, x
    WHERE r.user_id = p_user
      AND r.search_norm % x.q
    ORDER BY d
    LIMIT (SELECT cap FROM x)
  )
  SELECT b.id, (1::real - b.d::real) AS rank
  FROM base b, x
  WHERE b.d <= x.dcut
  ORDER BY b.d
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c20_s030(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c20_s030(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '20'
    SET "pg_trgm.similarity_threshold" TO '0.30'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c20_s030(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c20_s032(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c20_s032(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '20'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c20_s032(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c20_s034(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c20_s034(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '20'
    SET "pg_trgm.similarity_threshold" TO '0.34'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c20_s034(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c25_s030(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c25_s030(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.30'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c25_s030(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c25_s032(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c25_s032(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET enable_partition_pruning TO 'on'
    AS $_$
  SELECT * FROM public.search_records_fuzzy_ids_poc($1,$2,$3,$4,$5);
$_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c25_s032(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c25_s032_dyn(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c25_s032_dyn(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $_$
BEGIN
  RETURN QUERY EXECUTE format($f$
    WITH x AS (
      SELECT norm_text(%L) AS q,
             25            AS cap,
             0.86::float8  AS dcut
    ),
    base AS (
      SELECT r.id::uuid AS id,
             (r.search_norm <-> x.q) AS d
      FROM records_poc.records r, x
      WHERE r.user_id = %L::uuid
        AND r.search_norm %% x.q       -- escape trigram operator for format()
      ORDER BY d
      LIMIT (SELECT cap FROM x)
    )
    SELECT b.id, (1::real - b.d::real) AS rank
    FROM base b, x
    WHERE b.d <= x.dcut
    ORDER BY b.d
    LIMIT GREATEST(1, LEAST(1000, %s))
    OFFSET GREATEST(0, %s)
  $f$, p_q, p_user::text, p_limit, p_offset);
END$_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c25_s032_dyn(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c25_s034(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c25_s034(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.34'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c25_s034(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c30_s030(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c30_s030(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '30'
    SET "pg_trgm.similarity_threshold" TO '0.30'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c30_s030(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c30_s032(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c30_s032(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '30'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c30_s032(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_c30_s034(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_c30_s034(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '30'
    SET "pg_trgm.similarity_threshold" TO '0.34'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
          SELECT * FROM public.search_records_fuzzy_ids_poc_locked($1,$2,$3,$4,$5);
        $_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_c30_s034(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_fuzzy_ids_poc_locked(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_fuzzy_ids_poc_locked(p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
  cap  int    := GREATEST(10, LEAST(40, COALESCE(current_setting('app.search.rec_cap', true)::int, 25)));
  dcut float8 := COALESCE(current_setting('app.search.dist_cutoff', true)::float, 0.86);
  sql  text;
BEGIN
  sql := format($f$
    WITH x AS (
      SELECT %L::text    AS q,
             %L::int     AS cap,
             %L::float8  AS dcut
    ),
    base AS (
      SELECT r.id::uuid AS id,
             (r.search_norm <-> x.q) AS d,
             x.dcut
      FROM records_poc.records r, x
      WHERE r.user_id = %L::uuid
        AND r.search_norm %% x.q
      ORDER BY d
      LIMIT (SELECT cap FROM x)
    )
    SELECT b.id, (1::real - b.d::real) AS rank
    FROM base b, x
    WHERE b.d <= x.dcut
    ORDER BY b.d
    LIMIT GREATEST(1, LEAST(1000, %L::int))
    OFFSET GREATEST(0, %L::int)
  $f$, p_q, cap, dcut, p_user, p_limit, p_offset);

  RETURN QUERY EXECUTE sql;
END$_$;


ALTER FUNCTION public.search_records_fuzzy_ids_poc_locked(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  WITH x AS (SELECT norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id::uuid AS id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records_poc.records r, x
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND r.search_norm % x.q
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032_kn(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032_kn(p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE sql STABLE
    SET "app.search.rec_cap" TO '25'
    SET "pg_trgm.similarity_threshold" TO '0.32'
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    AS $$
  WITH x AS (SELECT norm_text(coalesce(p_q,'')) AS q)
  SELECT r.id::uuid AS id,
         (1::real - (r.search_norm <-> x.q)::real) AS rank
  FROM records_poc.records r, x
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  ORDER BY r.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;


ALTER FUNCTION public.search_records_hot_0dc268d0a86f4e128d109db0f1b735e0_c25_s032_kn(p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_super(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_super(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $_$
DECLARE
  sql text;
BEGIN
  /*
    Strategy:
    1) Build normalized text qn and tsquery qvec.
    2) Shortlist from MV by FTS if qvec has lexemes.
    3) UNION candidates from trigram on records + aliases (threshold tuned).
    4) Score: max(similarities, ts_rank), tie-break by <-> KNN distance.
    5) If result empty, auto-fallback to a looser trigram threshold.
  */
  sql := '
    WITH params AS (
      SELECT public.norm_text(coalesce($1, '''')) AS qn
    ),
    qts AS (
      -- tsquery from normalized text; websearch_to_tsquery handles quotes/phrases/operators
      SELECT websearch_to_tsquery(''simple'', p.qn) AS qvec, p.qn
      FROM params p
    ),

    -- 1) FTS shortlist from MV (very fast). Use only if qvec has any lexemes.
    fts AS (
      SELECT m.id
      FROM records.search_doc_mv m
      JOIN qts ON true
      WHERE m.user_id = ' || quote_literal(p_user)::text || '::uuid
        AND qts.qvec <> ''''::tsquery
        AND m.sv @@ qts.qvec
      ORDER BY ts_rank_cd(m.sv, qts.qvec) DESC
      LIMIT LEAST(600, GREATEST(200, $2*12))
    ),

    -- 2) Trigram candidates from records (percent operator)
    trgm_rec AS (
      SELECT r.id
      FROM records.records r
      JOIN params p ON true
      WHERE r.user_id = ' || quote_literal(p_user)::text || '::uuid
        AND r.search_norm % p.qn
        AND similarity(r.search_norm, p.qn) >= 0.50  -- start at 0.50; auto-fallback below if empty
      ORDER BY similarity(r.search_norm, p.qn) DESC
      LIMIT LEAST(600, GREATEST(200, $2*12))
    ),

    -- 3) Trigram from aliases (maps to record_id)
    trgm_alias AS (
      SELECT a.record_id AS id
      FROM records.aliases_mv a
      JOIN params p ON true
      WHERE a.user_id = ' || quote_literal(p_user)::text || '::uuid
        AND a.alias_norm % p.qn
        AND similarity(a.alias_norm, p.qn) >= 0.50
      ORDER BY similarity(a.alias_norm, p.qn) DESC
      LIMIT LEAST(600, GREATEST(200, $2*12))
    ),

    -- UNION all candidates (dedup)
    cand AS (
      SELECT id FROM fts
      UNION
      SELECT id FROM trgm_rec
      UNION
      SELECT id FROM trgm_alias
    ),

    -- Score candidates: combine trigram sims, alias sim, and ts_rank if available
    scored AS (
      SELECT r.id,
             GREATEST(
               similarity(r.search_norm, p.qn),
               similarity(r.artist_norm,  p.qn),
               similarity(r.name_norm,    p.qn),
               similarity(r.label_norm,   p.qn),
               similarity(r.catalog_norm, p.qn),
               COALESCE(al.alias_sim, 0)
             )                               AS sim,
             COALESCE(ts.ts_rank, 0)         AS ts_score,
             (r.search_norm <-> p.qn)        AS dist
      FROM cand c
      JOIN records.records r ON r.id = c.id
      JOIN params p          ON true
      LEFT JOIN LATERAL (
        SELECT MAX(similarity(a2.alias_norm, p.qn)) AS alias_sim
        FROM records.aliases_mv a2
        WHERE a2.user_id = r.user_id AND a2.record_id = r.id
      ) al ON true
      LEFT JOIN LATERAL (
        SELECT ts_rank_cd(m.sv, q.qvec) AS ts_rank
        FROM records.search_doc_mv m
        JOIN (SELECT * FROM qts) q ON true
        WHERE m.id = r.id AND m.user_id = r.user_id
      ) ts ON true
      WHERE r.user_id = ' || quote_literal(p_user)::text || '::uuid
    ),

    ranked AS (
      SELECT id,
             -- blend FTS and trigram (weight FTS slightly if present)
             (0.6*sim + 0.4*ts_score)::real AS rank,
             dist
      FROM scored
    ),

    final AS (
      SELECT id, rank
      FROM ranked
      ORDER BY rank DESC, dist ASC
      LIMIT GREATEST(1, LEAST(1000, $2))
      OFFSET GREATEST(0, $3)
    )

    SELECT * FROM final
  ';

  RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;

  -- Fallback: if we returned nothing, loosen trigram gates (0.48)
  IF NOT FOUND THEN
    sql := replace(sql, '>= 0.50', '>= 0.48');
    RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
  END IF;
END
$_$;


ALTER FUNCTION public.search_records_super(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: search_records_super2(uuid, text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_records_super2(p_user uuid, p_q text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false) RETURNS TABLE(id uuid, rank real)
    LANGUAGE plpgsql STABLE
    SET plan_cache_mode TO 'force_custom_plan'
    SET jit TO 'off'
    SET work_mem TO '64MB'
    SET random_page_cost TO '1.0'
    AS $_$
DECLARE
  sql text;

  function_sql CONSTANT text := $q$
    WITH p AS (
      SELECT public.norm_text(coalesce($1,'')) AS qn
    ),
    latin AS (
      SELECT regexp_replace(p.qn, '[^[:alnum:][:space:]]+', ' ', 'g') AS latin_raw
      FROM p
    ),
    toks AS (
      SELECT array_remove(regexp_split_to_array(lower(l.latin_raw), '\s+'), '') AS arr
      FROM latin l
    ),
    toks2 AS (
      SELECT array(SELECT t FROM unnest(arr) t WHERE length(t) >= 2 LIMIT 8) AS arr
      FROM toks
    ),
    ts AS (
      SELECT CASE WHEN cardinality(arr) > 0
                  THEN to_tsquery('simple',
                         array_to_string(
                           (SELECT array_agg(t || ':*') FROM unnest(arr) t),
                           ' & '
                         ))
                  ELSE NULL::tsquery
             END AS qvec
      FROM toks2
    ),
    caps AS (
      SELECT LEAST(300, GREATEST(150, $2*10)) AS cap
    ),
    -- FTS + trigram prune on doc
    fts AS (
      SELECT m.id, ts_rank_cd(m.sv, ts.qvec) AS ts_rank
      FROM records.search_doc_mv m
      JOIN ts ON ts.qvec IS NOT NULL
      JOIN p  ON true
      JOIN caps c ON true
      WHERE m.user_id = $U$USER$U::uuid
        AND m.sv @@ ts.qvec
        AND m.doc % p.qn
        AND similarity(m.doc, p.qn) >= 0.30
      ORDER BY ts_rank DESC
      LIMIT (SELECT cap FROM caps)
    ),
    gate AS (
      SELECT set_limit(0.52) AS _
    ),
    rec_trgm AS (
      SELECT r.id, similarity(r.search_norm, p.qn) AS sim
      FROM records.records r, p, gate, caps
      WHERE r.user_id = $U$USER$U::uuid
        AND r.search_norm % p.qn
        AND similarity(r.search_norm, p.qn) >= 0.52
      ORDER BY sim DESC
      LIMIT (SELECT cap FROM caps)
    ),
    alias_hits AS (
      SELECT a.record_id AS id, similarity(a.alias_norm, p.qn) AS sim
      FROM records.aliases_mv a, p, gate, caps
      WHERE a.user_id = $U$USER$U::uuid
        AND a.alias_norm % p.qn
        AND similarity(a.alias_norm, p.qn) >= 0.52
      ORDER BY sim DESC
      LIMIT (SELECT cap FROM caps)
    ),
    alias_sim AS (
      SELECT id, MAX(sim) AS alias_sim
      FROM alias_hits
      GROUP BY id
    ),
    cand AS (
      SELECT id FROM fts
      UNION
      SELECT id FROM rec_trgm
      UNION
      SELECT id FROM alias_hits
    ),
    scored AS (
      SELECT r.id,
             GREATEST(
               similarity(r.search_norm, p.qn),
               similarity(r.artist_norm,  p.qn),
               similarity(r.name_norm,    p.qn),
               similarity(r.label_norm,   p.qn),
               similarity(r.catalog_norm, p.qn),
               COALESCE(a.alias_sim, 0)
             ) AS sim,
             COALESCE(f.ts_rank, 0) AS ts_rank,
             (r.search_norm <-> p.qn) AS dist
      FROM cand c
      JOIN records.records r ON r.id = c.id
      JOIN p ON true
      LEFT JOIN alias_sim a ON a.id = r.id
      LEFT JOIN fts f       ON f.id = r.id
      WHERE r.user_id = $U$USER$U::uuid
    ),
    ranked AS (
      SELECT id, (0.70*sim + 0.30*ts_rank)::real AS rank, dist
      FROM scored
    )
    SELECT id, rank
    FROM ranked
    ORDER BY rank DESC, dist ASC
    LIMIT GREATEST(1, LEAST(1000, $2))
    OFFSET GREATEST(0, $3)
  $q$;

BEGIN
  sql := replace(function_sql, '$U$USER$U', quote_literal(p_user));

  RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;

  IF NOT FOUND THEN
    sql := replace(sql, '>= 0.52', '>= 0.50');
    sql := replace(sql, 'set_limit(0.52)', 'set_limit(0.50)');
    RETURN QUERY EXECUTE sql USING p_q, p_limit, p_offset;
  END IF;
END
$_$;


ALTER FUNCTION public.search_records_super2(p_user uuid, p_q text, p_limit integer, p_offset integer, p_strict boolean) OWNER TO postgres;

--
-- Name: trgm_identity(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trgm_identity(t text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
BEGIN
  RETURN t;
END
$$;


ALTER FUNCTION public.trgm_identity(t text) OWNER TO postgres;

--
-- Name: make_search_norm(text, text, text, text); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.make_search_norm(a text, n text, l text, c text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT public.norm_text(coalesce(a,'')||' '||coalesce(n,'')||' '||coalesce(l,'')||' '||coalesce(c,''));
$$;


ALTER FUNCTION records.make_search_norm(a text, n text, l text, c text) OWNER TO postgres;

--
-- Name: seed_aliases_for_user(uuid); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.seed_aliases_for_user(p_user uuid) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  n bigint := 0;
BEGIN
  WITH tgt AS (
    SELECT id, artist_norm
    FROM records.records
    WHERE user_id = p_user
  )
  SELECT COALESCE(sum(records.upsert_aliases(
           id,
           CASE
             WHEN artist_norm LIKE '%teresa%'  OR artist_norm LIKE '%鄧麗君%' OR artist_norm LIKE '%邓丽君%' THEN ARRAY['Teresa Teng','鄧麗君','邓丽君','テレサ・テン']
             WHEN artist_norm LIKE '%anita%'   OR artist_norm LIKE '%梅艷芳%' OR artist_norm LIKE '%梅艳芳%' THEN ARRAY['Anita Mui','梅艷芳','梅艳芳','アニタ・ムイ']
             WHEN artist_norm LIKE '%faye%'    OR artist_norm LIKE '%王菲%'                                  THEN ARRAY['Faye Wong','王菲','ワン・フェイ']
             WHEN artist_norm LIKE '%leslie%'  OR artist_norm LIKE '%張國榮%' OR artist_norm LIKE '%张国荣%' THEN ARRAY['Leslie Cheung','張國榮','张国荣','レスリー・チャン']
             ELSE ARRAY[]::text[]
           END
         )), 0)
    INTO n
  FROM tgt;
  RETURN n;
END
$$;


ALTER FUNCTION records.seed_aliases_for_user(p_user uuid) OWNER TO postgres;

--
-- Name: seed_demo(uuid, integer); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.seed_demo(p_user uuid, p_n integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  i int;
  artists text[] := ARRAY[
    'Teresa Teng','鄧麗君','邓丽君','テレサ・テン',
    'Anita Mui','梅艷芳','梅艳芳','アニタ・ムイ',
    'Faye Wong','王菲','ワン・フェイ',
    'Leslie Cheung','張國榮','张国荣','レスリー・チャン'
  ];
  formats text[] := ARRAY['LP','EP','12in','7in','CD'];
  labels  text[] := ARRAY['Polydor','PolyGram','Trio','CBS','Warner','EMI'];
  grades  text[] := ARRAY['NM','EX','VG+','VG'];
BEGIN
  INSERT INTO records.records(
    user_id, artist, name, format, catalog_number, notes,
    purchased_at, price_paid, record_grade, sleeve_grade,
    release_year, release_date, pressing_year, label, label_code
  )
  SELECT
    p_user,
    choice(artists) AS artist,
    'Album '||gs AS name,
    choice(formats) AS format,
    (choice(ARRAY['HK','TW','JP','CN','US'])||'-'||to_char((random()*999+1)::int,'FM000'))::text AS catalog_number,
    choice(ARRAY['','great','first press','promo']) AS notes,
    date '2018-01-01' + ((random()*((date '2024-12-31' - date '2018-01-01')))::int) AS purchased_at,
    round((random()*35+5)::numeric,2) AS price_paid,
    choice(grades) AS record_grade,
    choice(grades) AS sleeve_grade,
    (1970 + (random()*45)::int) AS release_year,
    (date '1970-01-01' + ((random()*18250)::int)) AS release_date,
    (1970 + (random()*45)::int) AS pressing_year,
    choice(labels) AS label,
    upper(substr(choice(labels),1,2)) || '-' || to_char((random()*999+1)::int,'FM000') AS label_code
  FROM generate_series(1,p_n) gs;

  -- make sure MV exists and populated
  PERFORM 1 FROM pg_matviews
    WHERE schemaname='records' AND matviewname='aliases_mv';
  IF FOUND THEN
    -- first run: non-concurrent is fine
    REFRESH MATERIALIZED VIEW records.aliases_mv;
  END IF;

  ANALYZE;
END
$$;


ALTER FUNCTION records.seed_demo(p_user uuid, p_n integer) OWNER TO postgres;

--
-- Name: set_norm_cols(); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.set_norm_cols() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.artist_norm  := norm_text(NEW.artist);
  NEW.name_norm    := norm_text(NEW.name);
  NEW.label_norm   := norm_text(NEW.label);
  NEW.catalog_norm := norm_text(NEW.catalog_number);
  NEW.search_norm  := btrim(concat_ws(' ', NEW.artist_norm, NEW.name_norm,
                                      coalesce(NEW.catalog_norm,''), coalesce(NEW.label_norm,'')));
  RETURN NEW;
END
$$;


ALTER FUNCTION records.set_norm_cols() OWNER TO postgres;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


ALTER FUNCTION records.touch_updated_at() OWNER TO postgres;

--
-- Name: upsert_alias(uuid, text); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.upsert_alias(p_record uuid, p_alias text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_alias IS NULL OR btrim(p_alias) = '' THEN
    RETURN;
  END IF;
  INSERT INTO records.aliases(record_id, alias)
  VALUES (p_record, btrim(p_alias))
  ON CONFLICT DO NOTHING;
END
$$;


ALTER FUNCTION records.upsert_alias(p_record uuid, p_alias text) OWNER TO postgres;

--
-- Name: upsert_aliases(uuid, text[]); Type: FUNCTION; Schema: records; Owner: postgres
--

CREATE FUNCTION records.upsert_aliases(p_record uuid, p_terms text[]) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  t text;
  n bigint := 0;
BEGIN
  IF p_terms IS NULL THEN RETURN 0; END IF;
  FOREACH t IN ARRAY p_terms LOOP
    BEGIN
      INSERT INTO records.aliases(record_id, alias)
      VALUES (p_record, btrim(t))
      ON CONFLICT DO NOTHING;
      IF FOUND THEN n := n + 1; END IF;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN n;
END
$$;


ALTER FUNCTION records.upsert_aliases(p_record uuid, p_terms text[]) OWNER TO postgres;

--
-- Name: aliases; Type: TABLE; Schema: records; Owner: record_owner
--

CREATE TABLE records.aliases (
    record_id uuid NOT NULL,
    alias text NOT NULL
);


ALTER TABLE records.aliases OWNER TO record_owner;

--
-- Name: aliases_mv; Type: MATERIALIZED VIEW; Schema: records; Owner: postgres
--

CREATE MATERIALIZED VIEW records.aliases_mv AS
 SELECT r.user_id,
    a.record_id,
    public.norm_text(a.alias) AS alias_norm
   FROM (records.aliases a
     JOIN records.records r ON ((r.id = a.record_id)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW records.aliases_mv OWNER TO postgres;

--
-- Name: record_aliases; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.record_aliases AS
 SELECT user_id,
    record_id,
    alias_norm
   FROM records.aliases_mv;


ALTER VIEW public.record_aliases OWNER TO postgres;

--
-- Name: v_official_body; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_official_body AS
 WITH x AS (
         SELECT public.norm_text('鄧麗君 album 263 cn-041 polygram'::text) AS q
        ), cand AS (
         SELECT h.id,
            public.similarity(h.search_norm, x.q) AS sim,
            (h.search_norm OPERATOR(public.<->) x.q) AS dist
           FROM records_hot.records_hot h,
            x
          WHERE ((h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid) AND (h.search_norm OPERATOR(public.%) x.q))
          ORDER BY (public.similarity(h.search_norm, x.q)) DESC
         LIMIT 600
        )
 SELECT id
   FROM cand
  ORDER BY dist
 LIMIT 50;


ALTER VIEW public.v_official_body OWNER TO postgres;

--
-- Name: artist_seed; Type: TABLE; Schema: records; Owner: postgres
--

CREATE TABLE records.artist_seed (
    canon text NOT NULL,
    aliases text[] NOT NULL
);


ALTER TABLE records.artist_seed OWNER TO postgres;

--
-- Name: autocomplete_terms_mv; Type: MATERIALIZED VIEW; Schema: records; Owner: postgres
--

CREATE MATERIALIZED VIEW records.autocomplete_terms_mv AS
 WITH base AS (
         SELECT r.user_id,
            a.alias AS term_raw
           FROM (records.aliases a
             JOIN records.records r ON ((r.id = a.record_id)))
        UNION ALL
         SELECT records.user_id,
            records.artist AS term_raw
           FROM records.records
        UNION ALL
         SELECT records.user_id,
            records.name AS term_raw
           FROM records.records
        UNION ALL
         SELECT records.user_id,
            records.label AS term_raw
           FROM records.records
        )
 SELECT user_id,
    term_raw,
    public.norm_text(term_raw) AS term_norm,
    (count(*))::integer AS hits
   FROM base
  WHERE ((term_raw IS NOT NULL) AND (btrim(term_raw) <> ''::text))
  GROUP BY user_id, term_raw, (public.norm_text(term_raw))
  WITH NO DATA;


ALTER MATERIALIZED VIEW records.autocomplete_terms_mv OWNER TO postgres;

--
-- Name: records_staging_v2; Type: TABLE; Schema: records; Owner: postgres
--

CREATE UNLOGGED TABLE records.records_staging_v2 (
    user_id uuid NOT NULL,
    artist text NOT NULL,
    name text NOT NULL,
    format text NOT NULL,
    catalog_number text NOT NULL,
    notes text,
    purchased_at date,
    price_paid numeric(8,2),
    record_grade text,
    sleeve_grade text,
    release_year integer,
    release_date date,
    pressing_year integer,
    label text,
    label_code text,
    artist_norm text,
    name_norm text,
    label_norm text,
    catalog_norm text,
    search_norm text
);


ALTER TABLE records.records_staging_v2 OWNER TO postgres;

--
-- Name: search_doc_mv; Type: MATERIALIZED VIEW; Schema: records; Owner: postgres
--

CREATE MATERIALIZED VIEW records.search_doc_mv AS
 SELECT r.id,
    r.user_id,
    concat_ws(' '::text, r.artist_norm, r.name_norm, r.label_norm, r.catalog_norm, COALESCE(a.aliases_text, ''::text)) AS doc,
    to_tsvector('simple'::regconfig, concat_ws(' '::text, r.artist_norm, r.name_norm, r.label_norm, r.catalog_norm, COALESCE(a.aliases_text, ''::text))) AS sv
   FROM (records.records r
     LEFT JOIN ( SELECT aliases_mv.record_id,
            aliases_mv.user_id,
            string_agg(aliases_mv.alias_norm, ' '::text ORDER BY aliases_mv.alias_norm) AS aliases_text
           FROM records.aliases_mv
          GROUP BY aliases_mv.record_id, aliases_mv.user_id) a ON (((a.record_id = r.id) AND (a.user_id = r.user_id))))
  WITH NO DATA;


ALTER MATERIALIZED VIEW records.search_doc_mv OWNER TO postgres;

--
-- Name: records_hot_0dc2; Type: TABLE; Schema: records_hot_iso; Owner: postgres
--

CREATE TABLE records_hot_iso.records_hot_0dc2 (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_norm text NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_threshold='50', autovacuum_vacuum_cost_limit='4000', autovacuum_vacuum_cost_delay='0');


ALTER TABLE records_hot_iso.records_hot_0dc2 OWNER TO postgres;

--
-- Name: aliases aliases_pkey; Type: CONSTRAINT; Schema: records; Owner: record_owner
--

ALTER TABLE ONLY records.aliases
    ADD CONSTRAINT aliases_pkey PRIMARY KEY (record_id, alias);


--
-- Name: artist_seed artist_seed_pkey; Type: CONSTRAINT; Schema: records; Owner: postgres
--

ALTER TABLE ONLY records.artist_seed
    ADD CONSTRAINT artist_seed_pkey PRIMARY KEY (canon);


--
-- Name: records records_pkey; Type: CONSTRAINT; Schema: records; Owner: record_owner
--

ALTER TABLE ONLY records.records
    ADD CONSTRAINT records_pkey PRIMARY KEY (id);


--
-- Name: records_hot_0dc2 records_hot_0dc2_pkey; Type: CONSTRAINT; Schema: records_hot_iso; Owner: postgres
--

ALTER TABLE ONLY records_hot_iso.records_hot_0dc2
    ADD CONSTRAINT records_hot_0dc2_pkey PRIMARY KEY (id);


--
-- Name: ac_terms_mv_uid_term_uq; Type: INDEX; Schema: records; Owner: postgres
--

CREATE UNIQUE INDEX ac_terms_mv_uid_term_uq ON records.autocomplete_terms_mv USING btree (user_id, term_raw, term_norm);


--
-- Name: ac_terms_user_hits; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX ac_terms_user_hits ON records.autocomplete_terms_mv USING btree (user_id, hits DESC);


--
-- Name: ac_terms_user_term_gist; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX ac_terms_user_term_gist ON records.autocomplete_terms_mv USING gist (user_id, term_norm public.gist_trgm_ops);


--
-- Name: aliases_mv_uniq_btree; Type: INDEX; Schema: records; Owner: postgres
--

CREATE UNIQUE INDEX aliases_mv_uniq_btree ON records.aliases_mv USING btree (user_id, record_id, alias_norm);


--
-- Name: aliases_mv_user_alias_gist; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX aliases_mv_user_alias_gist ON records.aliases_mv USING gist (user_id, alias_norm public.gist_trgm_ops);


--
-- Name: idx_records_artist_gist_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_artist_gist_trgm ON records.records USING gist (artist_norm public.gist_trgm_ops);


--
-- Name: idx_records_artist_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_artist_trgm ON records.records USING gin (artist public.gin_trgm_ops);


--
-- Name: idx_records_catalog_gist_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_catalog_gist_trgm ON records.records USING gist (catalog_norm public.gist_trgm_ops);


--
-- Name: idx_records_id_inc_user; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_id_inc_user ON records.records USING btree (id) INCLUDE (user_id);


--
-- Name: idx_records_label_gist_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_label_gist_trgm ON records.records USING gist (label_norm public.gist_trgm_ops);


--
-- Name: idx_records_name_gist_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_name_gist_trgm ON records.records USING gist (name_norm public.gist_trgm_ops);


--
-- Name: idx_records_name_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_name_trgm ON records.records USING gin (name public.gin_trgm_ops);


--
-- Name: idx_records_search_gin_trgm; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_search_gin_trgm ON records.records USING gin (search_norm public.gin_trgm_ops);


--
-- Name: idx_records_user; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_user ON records.records USING btree (user_id);


--
-- Name: idx_records_user_updated; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX idx_records_user_updated ON records.records USING btree (user_id, updated_at DESC);


--
-- Name: rec0dc2_alias_gin; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX rec0dc2_alias_gin ON records.aliases_mv USING gin (alias_norm public.gin_trgm_ops) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec0dc2_fts_gin; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX rec0dc2_fts_gin ON records.search_doc_mv USING gin (sv) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_0dc268d0_a86f_4e12_8d10_9db0f1b735e0_trgm_gin; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX rec_0dc268d0_a86f_4e12_8d10_9db0f1b735e0_trgm_gin ON records.records USING gin (search_norm public.gin_trgm_ops) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_0dc268d0_a86f_4e12_8d10_9db0f1b735e0_trgm_gist_knn; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX rec_0dc268d0_a86f_4e12_8d10_9db0f1b735e0_trgm_gist_knn ON records.records USING gist (search_norm public.gist_trgm_ops) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_alias_0dc268d0a86f4e12_alias_trgm_gin; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX rec_alias_0dc268d0a86f4e12_alias_trgm_gin ON records.aliases_mv USING gin (alias_norm public.gin_trgm_ops) WITH (fastupdate=off) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_hot_0dc268d0a86f4e128d109db0f1b735e0_searchnorm_trgm_gin; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX rec_hot_0dc268d0a86f4e128d109db0f1b735e0_searchnorm_trgm_gin ON records.records USING gin (search_norm public.gin_trgm_ops) WITH (fastupdate=off) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_hot_0dc268d0a86f4e12_searchnorm_trgm_gin; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX rec_hot_0dc268d0a86f4e12_searchnorm_trgm_gin ON records.records USING gin (search_norm public.gin_trgm_ops) WITH (fastupdate=off) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: rec_hot_0dc268d0a86f4e12_trgm_knn_cov; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX rec_hot_0dc268d0a86f4e12_trgm_knn_cov ON records.records USING gist (search_norm public.gist_trgm_ops) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: records_hot_000000000000000000000000000000aa_trgm_knn; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX records_hot_000000000000000000000000000000aa_trgm_knn ON records.records USING gist (search_norm public.gist_trgm_ops) WHERE (user_id = '00000000-0000-0000-0000-0000000000aa'::uuid);


--
-- Name: records_knn_cov_0dc268d0a86f4e128d109db0f1b735e0; Type: INDEX; Schema: records; Owner: record_owner
--

CREATE INDEX records_knn_cov_0dc268d0a86f4e128d109db0f1b735e0 ON records.records USING gist (search_norm public.gist_trgm_ops) INCLUDE (id) WHERE (user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);


--
-- Name: records_staging_v2_artist_name_format_idx; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX records_staging_v2_artist_name_format_idx ON records.records_staging_v2 USING btree (artist, name, format);


--
-- Name: records_staging_v2_catalog_number_idx; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX records_staging_v2_catalog_number_idx ON records.records_staging_v2 USING btree (catalog_number);


--
-- Name: records_staging_v2_user_id_idx; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX records_staging_v2_user_id_idx ON records.records_staging_v2 USING btree (user_id);


--
-- Name: search_doc_mv_doc_trgm_gin; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX search_doc_mv_doc_trgm_gin ON records.search_doc_mv USING gin (doc public.gin_trgm_ops);


--
-- Name: search_doc_mv_pk; Type: INDEX; Schema: records; Owner: postgres
--

CREATE UNIQUE INDEX search_doc_mv_pk ON records.search_doc_mv USING btree (id);


--
-- Name: search_doc_mv_sv_gin; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX search_doc_mv_sv_gin ON records.search_doc_mv USING gin (sv);


--
-- Name: search_doc_mv_user; Type: INDEX; Schema: records; Owner: postgres
--

CREATE INDEX search_doc_mv_user ON records.search_doc_mv USING btree (user_id);


--
-- Name: rh0dc2_trgm_gin; Type: INDEX; Schema: records_hot_iso; Owner: postgres
--

CREATE INDEX rh0dc2_trgm_gin ON records_hot_iso.records_hot_0dc2 USING gin (search_norm public.gin_trgm_ops) WITH (fastupdate=off);


--
-- Name: rh0dc2_trgm_gin_expr; Type: INDEX; Schema: records_hot_iso; Owner: postgres
--

CREATE INDEX rh0dc2_trgm_gin_expr ON records_hot_iso.records_hot_0dc2 USING gin (public.trgm_identity(search_norm) public.gin_trgm_ops) WITH (fastupdate=off);


--
-- Name: rh0dc2_trgm_gist; Type: INDEX; Schema: records_hot_iso; Owner: postgres
--

CREATE INDEX rh0dc2_trgm_gist ON records_hot_iso.records_hot_0dc2 USING gist (search_norm public.gist_trgm_ops) INCLUDE (id);

ALTER TABLE records_hot_iso.records_hot_0dc2 CLUSTER ON rh0dc2_trgm_gist;


--
-- Name: records records_hot_sync_del; Type: TRIGGER; Schema: records; Owner: record_owner
--

CREATE TRIGGER records_hot_sync_del AFTER DELETE ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();


--
-- Name: records records_hot_sync_ins; Type: TRIGGER; Schema: records; Owner: record_owner
--

CREATE TRIGGER records_hot_sync_ins AFTER INSERT ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();


--
-- Name: records records_hot_sync_upd; Type: TRIGGER; Schema: records; Owner: record_owner
--

CREATE TRIGGER records_hot_sync_upd AFTER UPDATE OF user_id, search_norm ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();


--
-- Name: records trg_records_norm; Type: TRIGGER; Schema: records; Owner: record_owner
--

CREATE TRIGGER trg_records_norm BEFORE INSERT OR UPDATE ON records.records FOR EACH ROW EXECUTE FUNCTION records.set_norm_cols();


--
-- Name: records trg_records_touch; Type: TRIGGER; Schema: records; Owner: record_owner
--

CREATE TRIGGER trg_records_touch BEFORE UPDATE ON records.records FOR EACH ROW EXECUTE FUNCTION records.touch_updated_at();


--
-- Name: aliases aliases_record_id_fkey; Type: FK CONSTRAINT; Schema: records; Owner: record_owner
--

ALTER TABLE ONLY records.aliases
    ADD CONSTRAINT aliases_record_id_fkey FOREIGN KEY (record_id) REFERENCES records.records(id) ON DELETE CASCADE;


--
-- Name: records records_user_id_fkey; Type: FK CONSTRAINT; Schema: records; Owner: record_owner
--

ALTER TABLE ONLY records.records
    ADD CONSTRAINT records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO record_app;


--
-- Name: SCHEMA records; Type: ACL; Schema: -; Owner: record_owner
--

GRANT USAGE ON SCHEMA records TO record_app;


--
-- Name: FUNCTION choice(anyarray); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.choice(anyarray) TO record_app;


--
-- Name: FUNCTION norm_text(t text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.norm_text(t text) TO record_app;


--
-- Name: TABLE records; Type: ACL; Schema: records; Owner: record_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.records TO record_app;


--
-- Name: FUNCTION records_recent(p_user uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.records_recent(p_user uuid, p_limit integer) TO record_app;


--
-- Name: FUNCTION search_autocomplete(p_user uuid, p_q text, p_k integer, p_field text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_autocomplete(p_user uuid, p_q text, p_k integer, p_field text) TO record_app;


--
-- Name: FUNCTION search_facets(p_user uuid, p_q text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_facets(p_user uuid, p_q text) TO record_app;


--
-- Name: FUNCTION seed_demo(p_user uuid, p_n integer); Type: ACL; Schema: records; Owner: postgres
--

GRANT ALL ON FUNCTION records.seed_demo(p_user uuid, p_n integer) TO record_app;


--
-- Name: FUNCTION set_norm_cols(); Type: ACL; Schema: records; Owner: postgres
--

GRANT ALL ON FUNCTION records.set_norm_cols() TO record_app;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: records; Owner: postgres
--

GRANT ALL ON FUNCTION records.touch_updated_at() TO record_app;


--
-- Name: TABLE aliases; Type: ACL; Schema: records; Owner: record_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.aliases TO record_app;


--
-- Name: TABLE aliases_mv; Type: ACL; Schema: records; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.aliases_mv TO record_app;


--
-- Name: TABLE artist_seed; Type: ACL; Schema: records; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.artist_seed TO record_app;


--
-- Name: TABLE autocomplete_terms_mv; Type: ACL; Schema: records; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.autocomplete_terms_mv TO record_app;


--
-- Name: TABLE records_staging_v2; Type: ACL; Schema: records; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.records_staging_v2 TO record_app;


--
-- Name: TABLE search_doc_mv; Type: ACL; Schema: records; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE records.search_doc_mv TO record_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: record_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO record_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: record_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO record_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: records; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA records GRANT SELECT,USAGE ON SEQUENCES TO record_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: records; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA records GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO record_app;


--
-- PostgreSQL database dump complete
--

\unrestrict CtZBXEIauv3FPcDpbFewDglcDmobLf7cBwvIxHaFyjq5c7cYLryw3o6WioktEqa

