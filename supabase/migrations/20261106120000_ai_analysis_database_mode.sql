BEGIN;

CREATE SCHEMA "AI_Crypto_Bot_Internal";
REVOKE ALL ON SCHEMA "AI_Crypto_Bot_Internal" FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA "AI_Crypto_Bot_Internal" TO service_role;

CREATE FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(p_value double precision)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_bytes bytea;
  v_bits bigint := 0;
  v_exponent integer;
  v_fraction bigint;
  v_significand numeric;
  v_binary_exponent integer;
  v_exact_value numeric;
  v_sign numeric;
  v_index integer;
BEGIN
  IF p_value IN (
    'NaN'::double precision,
    'Infinity'::double precision,
    '-Infinity'::double precision
  ) THEN
    RETURN NULL;
  END IF;

  v_bytes := pg_catalog.float8send(p_value);
  FOR v_index IN 0..7 LOOP
    v_bits := (v_bits << 8) | pg_catalog.get_byte(v_bytes, v_index)::bigint;
  END LOOP;

  v_sign := CASE WHEN v_bits < 0 THEN -1 ELSE 1 END;
  v_exponent := ((v_bits >> 52) & 2047)::integer;
  v_fraction := v_bits & 4503599627370495;
  IF v_exponent = 0 THEN
    v_significand := v_fraction::numeric;
    v_binary_exponent := -1074;
  ELSE
    v_significand := (v_fraction + 4503599627370496)::numeric;
    v_binary_exponent := v_exponent - 1023 - 52;
  END IF;

  v_exact_value := v_significand;
  IF v_binary_exponent > 0 THEN
    v_exact_value := v_exact_value * pg_catalog.power(2::numeric, v_binary_exponent);
  ELSIF v_binary_exponent < 0 THEN
    v_exact_value := v_exact_value / pg_catalog.power(2::numeric, -v_binary_exponent);
  END IF;

  RETURN v_sign * pg_catalog.round(v_exact_value * 100) / 100;
END;
$function$;

CREATE FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
  p_value double precision,
  p_minimum double precision,
  p_maximum double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT LEAST(p_maximum, GREATEST(p_minimum, p_value))
$function$;

CREATE FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(
  p_values double precision[],
  p_period integer
)
RETURNS double precision[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_length integer := COALESCE(pg_catalog.array_length(p_values, 1), 0);
  v_series double precision[];
  v_ema double precision;
  v_multiplier double precision;
  v_sum double precision := 0;
  v_index integer;
BEGIN
  IF p_period < 1 OR v_length < p_period THEN
    RETURN NULL;
  END IF;

  v_series := pg_catalog.array_fill(NULL::double precision, ARRAY[v_length]);
  FOR v_index IN 1..p_period LOOP
    v_sum := v_sum + p_values[v_index];
  END LOOP;
  v_ema := v_sum / p_period;
  v_series[p_period] := v_ema;
  v_multiplier := 2::double precision / (p_period + 1);

  FOR v_index IN (p_period + 1)..v_length LOOP
    v_ema := p_values[v_index] * v_multiplier
      + v_ema * (1 - v_multiplier);
    v_series[v_index] := v_ema;
  END LOOP;

  RETURN v_series;
END;
$function$;

CREATE FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
  p_highs double precision[],
  p_lows double precision[],
  p_closes double precision[],
  p_volumes double precision[]
)
RETURNS TABLE(score numeric, indicators jsonb)
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_length integer := COALESCE(pg_catalog.array_length(p_closes, 1), 0);
  v_ema12_series double precision[];
  v_ema26_series double precision[];
  v_signal_series double precision[];
  v_macd_values double precision[] := '{}'::double precision[];
  v_feature_values double precision[] := '{}'::double precision[];
  v_feature_weights double precision[] := '{}'::double precision[];
  v_ema12 double precision;
  v_ema26 double precision;
  v_rsi double precision;
  v_macd_line double precision;
  v_macd_signal double precision;
  v_macd_histogram double precision;
  v_current_change double precision;
  v_previous_change double precision;
  v_volume_average double precision;
  v_volume_ratio double precision;
  v_volume_score double precision;
  v_volume_latest double precision;
  v_last_change double precision;
  v_mean_price double precision;
  v_true_range_sum double precision;
  v_range double precision;
  v_atr_pct double precision;
  v_volatility_level text := 'insufficient';
  v_momentum_direction text;
  v_volume_classification text := 'insufficient';
  v_average_gain double precision;
  v_average_loss double precision;
  v_gains double precision := 0;
  v_losses double precision := 0;
  v_weight_total double precision := 0;
  v_weighted_total double precision := 0;
  v_sum double precision;
  v_index integer;
  v_start integer;
BEGIN
  v_volume_latest := CASE WHEN v_length > 0 THEN p_volumes[v_length] ELSE NULL END;
  v_ema12_series := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(p_closes, 12);
  v_ema26_series := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(p_closes, 26);
  IF v_ema12_series IS NOT NULL THEN
    v_ema12 := v_ema12_series[v_length];
  END IF;
  IF v_ema26_series IS NOT NULL THEN
    v_ema26 := v_ema26_series[v_length];
  END IF;

  IF v_length > 14 THEN
    v_start := v_length - 14 + 1;
    FOR v_index IN v_start..v_length LOOP
      v_range := p_closes[v_index] - p_closes[v_index - 1];
      v_gains := v_gains + GREATEST(v_range, 0);
      v_losses := v_losses + GREATEST(-v_range, 0);
    END LOOP;
    v_average_gain := v_gains / 14;
    v_average_loss := v_losses / 14;
    IF v_average_gain = 0 AND v_average_loss = 0 THEN
      v_rsi := 50;
    ELSIF v_average_loss = 0 THEN
      v_rsi := 100;
    ELSIF v_average_gain = 0 THEN
      v_rsi := 0;
    ELSE
      v_rsi := 100 - 100 / (1 + v_average_gain / v_average_loss);
    END IF;
  END IF;

  IF v_length >= 34 THEN
    FOR v_index IN 26..v_length LOOP
      v_macd_values := pg_catalog.array_append(
        v_macd_values,
        v_ema12_series[v_index] - v_ema26_series[v_index]
      );
    END LOOP;
    v_signal_series := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(v_macd_values, 9);
    v_macd_line := v_macd_values[pg_catalog.array_length(v_macd_values, 1)];
    v_macd_signal := v_signal_series[pg_catalog.array_length(v_signal_series, 1)];
    v_macd_histogram := v_macd_line - v_macd_signal;
  END IF;

  IF v_length >= 6 THEN
    v_current_change := (p_closes[v_length] - p_closes[v_length - 5])
      / p_closes[v_length - 5] * 100;
    IF v_length >= 11 THEN
      v_previous_change := (p_closes[v_length - 5] - p_closes[v_length - 10])
        / p_closes[v_length - 10] * 100;
    END IF;
    IF v_previous_change IS NOT NULL THEN
      IF ABS(v_current_change) = 0 THEN
        v_momentum_direction := 'sideways';
      ELSIF ABS(v_current_change) > ABS(v_previous_change) THEN
        v_momentum_direction := 'accelerating';
      ELSE
        v_momentum_direction := 'weakening';
      END IF;
    END IF;
  END IF;

  IF v_length >= 6 THEN
    v_sum := 0;
    v_start := GREATEST(1, v_length - 20);
    FOR v_index IN v_start..(v_length - 1) LOOP
      v_sum := v_sum + p_volumes[v_index];
    END LOOP;
    v_volume_average := v_sum / (v_length - v_start);
    IF v_volume_average > 0 THEN
      v_volume_ratio := v_volume_latest / v_volume_average;
    END IF;
    v_last_change := (p_closes[v_length] - p_closes[v_length - 1])
      / p_closes[v_length - 1] * 100;
    IF v_volume_ratio IS NOT NULL THEN
      IF v_volume_ratio >= 1.5 THEN
        v_volume_classification := 'increasing';
        v_volume_score := SIGN(v_last_change)
          * "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
            (v_volume_ratio - 1) * 25, 0, 60
          );
      ELSIF v_volume_ratio <= 0.5 THEN
        v_volume_classification := 'decreasing';
        v_volume_score := -SIGN(v_last_change) * 10;
      ELSE
        v_volume_classification := 'normal';
        v_volume_score := 0;
      END IF;
    END IF;
  END IF;

  IF v_length >= 2 THEN
    v_start := GREATEST(1, v_length - 14);
    v_sum := 0;
    v_mean_price := 0;
    FOR v_index IN v_start..v_length LOOP
      v_mean_price := v_mean_price + p_closes[v_index];
    END LOOP;
    v_mean_price := v_mean_price / (v_length - v_start + 1);
    v_true_range_sum := 0;
    FOR v_index IN (v_start + 1)..v_length LOOP
      v_range := GREATEST(
        p_highs[v_index] - p_lows[v_index],
        ABS(p_highs[v_index] - p_closes[v_index - 1]),
        ABS(p_lows[v_index] - p_closes[v_index - 1])
      );
      v_true_range_sum := v_true_range_sum + v_range;
    END LOOP;
    IF v_mean_price > 0 THEN
      v_atr_pct := v_true_range_sum / (v_length - v_start)
        / v_mean_price * 100;
    END IF;
    IF v_atr_pct IS NOT NULL THEN
      v_volatility_level := CASE
        WHEN v_atr_pct < 0.5 THEN 'low'
        WHEN v_atr_pct < 2 THEN 'medium'
        ELSE 'high'
      END;
    END IF;
  END IF;

  IF v_ema12 IS NOT NULL AND v_ema26 IS NOT NULL THEN
    v_feature_values := pg_catalog.array_append(
      v_feature_values,
      "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"((v_ema12 - v_ema26) / v_ema26 * 5000, -100, 100)
    );
    v_feature_weights := pg_catalog.array_append(v_feature_weights, 0.3);
  END IF;
  IF v_current_change IS NOT NULL THEN
    v_feature_values := pg_catalog.array_append(
      v_feature_values,
      "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_current_change)::double precision * 20,
        -100,
        100
      )
    );
    v_feature_weights := pg_catalog.array_append(v_feature_weights, 0.25);
  END IF;
  IF v_rsi IS NOT NULL THEN
    v_feature_values := pg_catalog.array_append(
      v_feature_values,
      "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"((v_rsi - 50) * 2, -100, 100)
    );
    v_feature_weights := pg_catalog.array_append(v_feature_weights, 0.15);
  END IF;
  IF v_macd_histogram IS NOT NULL AND v_length > 0 THEN
    v_feature_values := pg_catalog.array_append(
      v_feature_values,
      "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_macd_histogram)::double precision
          / p_closes[v_length] * 20000,
        -100,
        100
      )
    );
    v_feature_weights := pg_catalog.array_append(v_feature_weights, 0.15);
  END IF;
  IF v_volume_score IS NOT NULL THEN
    v_feature_values := pg_catalog.array_append(
      v_feature_values,
      "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_volume_score)::double precision
    );
    v_feature_weights := pg_catalog.array_append(v_feature_weights, 0.15);
  END IF;

  FOR v_index IN 1..COALESCE(pg_catalog.array_length(v_feature_values, 1), 0) LOOP
    v_weight_total := v_weight_total + v_feature_weights[v_index];
    v_weighted_total := v_weighted_total
      + v_feature_values[v_index] * v_feature_weights[v_index];
  END LOOP;
  IF v_weight_total > 0 THEN
    score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_weighted_total / v_weight_total);
  ELSE
    score := NULL;
  END IF;

  indicators := pg_catalog.jsonb_build_object(
    'trend',
    CASE
      WHEN v_ema12 IS NULL OR v_ema26 IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'direction', CASE WHEN v_ema12 > v_ema26 THEN 'bullish'
                         WHEN v_ema12 < v_ema26 THEN 'bearish' ELSE 'sideways' END,
        'ema12', "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_ema12),
        'ema26', "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_ema26),
        'percentSpread', "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
          (v_ema12 - v_ema26) / v_ema26 * 100
        )
      )
    END,
    'momentum', pg_catalog.jsonb_build_object(
      'changePct', CASE WHEN v_current_change IS NULL THEN NULL
                        ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_current_change) END,
      'accelerationPct', CASE
        WHEN v_current_change IS NULL OR v_previous_change IS NULL THEN NULL
        ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_current_change - v_previous_change)
      END,
      'direction', v_momentum_direction
    ),
    'rsi14', CASE WHEN v_rsi IS NULL THEN NULL
                  ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_rsi) END,
    'macd', pg_catalog.jsonb_build_object(
      'line', CASE WHEN v_macd_line IS NULL THEN NULL
                   ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_macd_line) END,
      'signal', CASE WHEN v_macd_signal IS NULL THEN NULL
                     ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_macd_signal) END,
      'histogram', CASE WHEN v_macd_histogram IS NULL THEN NULL
                        ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_macd_histogram) END
    ),
    'volume', pg_catalog.jsonb_build_object(
      'latest', CASE WHEN v_volume_latest IS NULL THEN NULL
                     ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_volume_latest) END,
      'average', CASE WHEN v_volume_average IS NULL THEN NULL
                      ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_volume_average) END,
      'ratio', CASE WHEN v_volume_ratio IS NULL THEN NULL
                    ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_volume_ratio) END,
      'classification', v_volume_classification,
      'score', CASE WHEN v_volume_score IS NULL THEN NULL
                    ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_volume_score) END
    ),
    'volatility', pg_catalog.jsonb_build_object(
      'atrPct', CASE WHEN v_atr_pct IS NULL THEN NULL
                     ELSE "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_atr_pct) END,
      'level', v_volatility_level
    )
  );
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(p_analysis_time timestamptz)
RETURNS TABLE(
  analyzed_markets integer,
  decisions_stored integer,
  buy_count integer,
  sell_count integer,
  hold_count integer,
  wait_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_market record;
  v_interval_row record;
  v_symbol text;
  v_interval text;
  v_max_age_ms bigint;
  v_snapshot public."AI_Crypto_Bot_Market_Data"%ROWTYPE;
  v_snapshot_found boolean;
  v_snapshot_stale boolean;
  v_snapshot_available boolean;
  v_snapshot_time_ms bigint;
  v_now_ms bigint;
  v_price double precision;
  v_daily_change double precision;
  v_volume double precision;
  v_high24h double precision;
  v_low24h double precision;
  v_range_position numeric;
  v_market_change_score double precision;
  v_range_position_score double precision;
  v_market_context_score double precision;
  v_timeframe_score numeric;
  v_score numeric;
  v_confidence double precision;
  v_confidence_numeric numeric;
  v_candle_coverage double precision;
  v_average_depth double precision;
  v_depth_total double precision;
  v_volatility_penalty double precision;
  v_sufficient boolean;
  v_decision text;
  v_reason text;
  v_timeframe_text text;
  v_timeframes jsonb;
  v_indicators jsonb;
  v_market_data_indicator jsonb;
  v_tf_indicators jsonb;
  v_closes double precision[];
  v_highs double precision[];
  v_lows double precision[];
  v_volumes double precision[];
  v_timestamps timestamptz[];
  v_valid_count integer;
  v_invalid_count integer;
  v_total_invalid integer;
  v_stale_count integer;
  v_stale_ignored integer;
  v_stale_intervals text[];
  v_valid_intervals text[];
  v_valid_scores numeric[];
  v_valid_counts integer[];
  v_valid_volatility_levels text[];
  v_valid_weights double precision[];
  v_latest_candle_ms bigint;
  v_fresh boolean;
  v_index integer;
  v_valid_total integer;
  v_weight_total double precision;
  v_weighted_total double precision;
BEGIN
  IF p_analysis_time IS NULL OR NOT pg_catalog.isfinite(p_analysis_time) THEN
    RAISE EXCEPTION 'Analysis time must be a finite timestamp.'
      USING ERRCODE = '22023';
  END IF;

  v_now_ms := FLOOR(EXTRACT(epoch FROM p_analysis_time) * 1000)::bigint;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT symbol
      FROM public."AI_Crypto_Bot_Watched_Markets"
      WHERE enabled = true
      ORDER BY priority ASC, symbol ASC
      LIMIT 2000
    ) AS bounded_markets
    WHERE bounded_markets.symbol !~ '^[A-Z0-9]+-EUR$'
  ) THEN
    RAISE EXCEPTION 'Enabled watched markets contain an invalid EUR symbol.'
      USING ERRCODE = '22023';
  END IF;

  analyzed_markets := 0;
  decisions_stored := 0;
  buy_count := 0;
  sell_count := 0;
  hold_count := 0;
  wait_count := 0;

  FOR v_market IN
    SELECT symbol
    FROM public."AI_Crypto_Bot_Watched_Markets"
    WHERE enabled = true
    ORDER BY priority ASC, symbol ASC
    LIMIT 2000
  LOOP
    v_symbol := v_market.symbol;
    v_timeframes := '{}'::jsonb;
    v_valid_intervals := '{}'::text[];
    v_valid_scores := '{}'::numeric[];
    v_valid_counts := '{}'::integer[];
    v_valid_volatility_levels := '{}'::text[];
    v_valid_weights := '{}'::double precision[];
    v_stale_intervals := '{}'::text[];
    v_total_invalid := 0;
    v_stale_ignored := 0;
    v_depth_total := 0;
    v_volatility_penalty := 0;

    SELECT
      market_data.id,
      market_data.symbol,
      market_data.price,
      market_data.volume,
      market_data.daily_change,
      market_data.high_24h,
      market_data.low_24h,
      market_data.captured_at
    INTO v_snapshot
    FROM public."AI_Crypto_Bot_Market_Data" AS market_data
    WHERE market_data.symbol = v_symbol;
    v_snapshot_found := FOUND;
    v_snapshot_stale := false;
    v_snapshot_available := false;
    v_price := NULL;
    v_daily_change := NULL;
    v_volume := NULL;
    v_high24h := NULL;
    v_low24h := NULL;
    v_range_position := NULL;
    v_market_change_score := NULL;
    v_range_position_score := NULL;
    v_market_context_score := NULL;

    IF v_snapshot_found THEN
      v_price := v_snapshot.price::double precision;
      v_daily_change := v_snapshot.daily_change::double precision;
      v_volume := v_snapshot.volume::double precision;
      v_high24h := v_snapshot.high_24h::double precision;
      v_low24h := v_snapshot.low_24h::double precision;
      v_snapshot_stale := CASE
        WHEN NOT pg_catalog.isfinite(v_snapshot.captured_at) THEN true
        ELSE v_now_ms - FLOOR(EXTRACT(epoch FROM v_snapshot.captured_at) * 1000)::bigint
            > 900000
          OR v_now_ms < FLOOR(EXTRACT(epoch FROM v_snapshot.captured_at) * 1000)::bigint
      END;
      v_snapshot_available := NOT v_snapshot_stale
        AND v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        )
        AND v_daily_change NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        )
        AND v_volume >= 0
        AND v_volume NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        );

      IF v_snapshot_available THEN
        v_market_change_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
          v_daily_change * 8, -100, 100
        );
      END IF;

      IF v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_high24h > v_low24h
        AND v_high24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_low24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_low24h >= 0
        AND v_price >= v_low24h AND v_price <= v_high24h THEN
        v_range_position := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
          (v_price - v_low24h) / (v_high24h - v_low24h) * 100
        );
        v_range_position_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
          (v_range_position::double precision - 50) * 2, -100, 100
        );
      END IF;

      IF v_market_change_score IS NOT NULL THEN
        v_market_context_score := CASE
          WHEN v_range_position_score IS NULL THEN v_market_change_score
          ELSE v_market_change_score * 0.7 + v_range_position_score * 0.3
        END;
      END IF;
    END IF;

    FOR v_interval_row IN
      SELECT interval_name, max_age_ms, weight
      FROM (
        VALUES
          ('1m'::text, 1800000::bigint, 0.05::double precision),
          ('5m'::text, 7200000::bigint, 0.1::double precision),
          ('15m'::text, 21600000::bigint, 0.15::double precision),
          ('1h'::text, 43200000::bigint, 0.25::double precision),
          ('4h'::text, 86400000::bigint, 0.3::double precision),
          ('1d'::text, 259200000::bigint, 0.15::double precision)
      ) AS intervals(interval_name, max_age_ms, weight)
    LOOP
      v_interval := v_interval_row.interval_name;
      v_max_age_ms := v_interval_row.max_age_ms;

      WITH bounded AS (
        SELECT
          candle.timestamp,
          candle.open::double precision AS open_value,
          candle.high::double precision AS high_value,
          candle.low::double precision AS low_value,
          candle.close::double precision AS close_value,
          candle.volume::double precision AS volume_value
        FROM public."AI_Crypto_Bot_Candles" AS candle
        WHERE candle.symbol = v_symbol
          AND candle.interval = v_interval
        ORDER BY candle.timestamp DESC
        LIMIT 150
      ),
      classified AS (
        SELECT
          bounded.timestamp,
          bounded.open_value,
          bounded.high_value,
          bounded.low_value,
          bounded.close_value,
          bounded.volume_value,
          (
            pg_catalog.isfinite(bounded.timestamp)
            AND bounded.open_value > 0
            AND bounded.close_value > 0
            AND bounded.volume_value >= 0
            AND bounded.open_value NOT IN (
              'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
            )
            AND bounded.high_value NOT IN (
              'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
            )
            AND bounded.low_value NOT IN (
              'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
            )
            AND bounded.close_value NOT IN (
              'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
            )
            AND bounded.volume_value NOT IN (
              'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
            )
            AND bounded.high_value >= GREATEST(
              bounded.open_value, bounded.close_value, bounded.low_value
            )
            AND bounded.low_value <= LEAST(
              bounded.open_value, bounded.close_value
            )
          ) AS valid
        FROM bounded
      )
      SELECT
        COUNT(*) FILTER (WHERE NOT classified.valid)::integer,
        COALESCE(
          pg_catalog.array_agg(classified.close_value ORDER BY
            FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
            classified.timestamp DESC
          ) FILTER (WHERE classified.valid),
          '{}'::double precision[]
        ),
        COALESCE(
          pg_catalog.array_agg(classified.high_value ORDER BY
            FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
            classified.timestamp DESC
          ) FILTER (WHERE classified.valid),
          '{}'::double precision[]
        ),
        COALESCE(
          pg_catalog.array_agg(classified.low_value ORDER BY
            FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
            classified.timestamp DESC
          ) FILTER (WHERE classified.valid),
          '{}'::double precision[]
        ),
        COALESCE(
          pg_catalog.array_agg(classified.volume_value ORDER BY
            FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
            classified.timestamp DESC
          ) FILTER (WHERE classified.valid),
          '{}'::double precision[]
        ),
        COALESCE(
          pg_catalog.array_agg(classified.timestamp ORDER BY
            FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
            classified.timestamp DESC
          ) FILTER (WHERE classified.valid),
          '{}'::timestamptz[]
        )
      INTO
        v_invalid_count,
        v_closes,
        v_highs,
        v_lows,
        v_volumes,
        v_timestamps
      FROM classified;

      v_valid_count := COALESCE(pg_catalog.array_length(v_closes, 1), 0);
      v_total_invalid := v_total_invalid + v_invalid_count;
      v_stale_count := 0;
      v_fresh := false;
      IF v_valid_count > 0 THEN
        v_latest_candle_ms := FLOOR(
          EXTRACT(epoch FROM v_timestamps[v_valid_count]) * 1000
        )::bigint;
        v_fresh := v_now_ms - v_latest_candle_ms >= 0
          AND v_now_ms - v_latest_candle_ms <= v_max_age_ms;
        IF NOT v_fresh THEN
          v_stale_count := v_valid_count;
          v_stale_ignored := v_stale_ignored + v_valid_count;
          v_stale_intervals := pg_catalog.array_append(v_stale_intervals, v_interval);
        END IF;
      END IF;

      IF v_fresh THEN
        SELECT timeframe.score, timeframe.indicators
        INTO v_timeframe_score, v_tf_indicators
        FROM "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
          v_highs,
          v_lows,
          v_closes,
          v_volumes
        ) AS timeframe;
      ELSE
        v_timeframe_score := NULL;
        SELECT timeframe.score, timeframe.indicators
        INTO v_timeframe_score, v_tf_indicators
        FROM "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
          '{}'::double precision[],
          '{}'::double precision[],
          '{}'::double precision[],
          '{}'::double precision[]
        ) AS timeframe;
      END IF;

      v_timeframes := v_timeframes || pg_catalog.jsonb_build_object(
        v_interval,
        pg_catalog.jsonb_build_object(
          'candleCount', v_valid_count,
          'analyzedCandleCount', CASE WHEN v_fresh THEN v_valid_count ELSE 0 END,
          'staleCandleCount', v_stale_count,
          'stale', v_stale_count > 0,
          'invalidCandleCount', v_invalid_count,
          'trend', v_tf_indicators -> 'trend',
          'momentum', v_tf_indicators -> 'momentum',
          'rsi14', v_tf_indicators -> 'rsi14',
          'macd', v_tf_indicators -> 'macd',
          'volume', v_tf_indicators -> 'volume',
          'volatility', v_tf_indicators -> 'volatility'
        )
      );

      IF v_fresh AND v_valid_count >= 26 THEN
        v_valid_intervals := pg_catalog.array_append(v_valid_intervals, v_interval);
        v_valid_scores := pg_catalog.array_append(v_valid_scores, v_timeframe_score);
        v_valid_counts := pg_catalog.array_append(v_valid_counts, v_valid_count);
        v_valid_volatility_levels := pg_catalog.array_append(
          v_valid_volatility_levels,
          v_tf_indicators #>> '{volatility,level}'
        );
        v_valid_weights := pg_catalog.array_append(v_valid_weights, v_interval_row.weight);
        v_depth_total := v_depth_total + LEAST(v_valid_count::double precision / 100, 1);
        v_volatility_penalty := v_volatility_penalty
          + CASE v_tf_indicators #>> '{volatility,level}'
              WHEN 'high' THEN 12
              WHEN 'medium' THEN 4
              ELSE 0
            END;
      END IF;
    END LOOP;

    v_valid_total := COALESCE(pg_catalog.array_length(v_valid_intervals, 1), 0);
    v_candle_coverage := v_valid_total::double precision / 6;
    v_average_depth := CASE WHEN v_valid_total = 0 THEN 0
      ELSE v_depth_total / v_valid_total END;
    v_volatility_penalty := CASE WHEN v_valid_total = 0 THEN 0
      ELSE v_volatility_penalty / v_valid_total END;

    v_weight_total := 0;
    v_weighted_total := 0;
    FOR v_index IN 1..v_valid_total LOOP
      v_weight_total := v_weight_total + v_valid_weights[v_index];
      v_weighted_total := v_weighted_total
        + v_valid_scores[v_index]::double precision * v_valid_weights[v_index];
    END LOOP;
    IF v_weight_total > 0 THEN
      v_timeframe_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
        v_weighted_total / v_weight_total
      );
    ELSE
      v_timeframe_score := NULL;
    END IF;

    v_score := CASE
      WHEN v_timeframe_score IS NULL THEN NULL
      WHEN v_snapshot_available THEN "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
        v_timeframe_score::double precision * 0.9 + v_market_context_score * 0.1
      )
      ELSE v_timeframe_score
    END;
    v_sufficient := v_snapshot_available AND v_valid_total >= 2;
    IF v_sufficient THEN
      v_confidence := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        35 + ABS(v_score::double precision) * 0.38 + v_candle_coverage * 15
          + v_average_depth * 10 - v_volatility_penalty,
        0,
        95
      );
    ELSE
      v_confidence := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        12 + v_candle_coverage * 20 + v_average_depth * 12
          + CASE WHEN v_snapshot_available THEN 6 ELSE 0 END,
        0,
        49
      );
    END IF;
    IF v_valid_total < 4 THEN
      v_confidence := LEAST(v_confidence, 64);
    END IF;
    v_confidence_numeric := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_confidence);

    v_decision := 'WAIT';
    IF v_sufficient THEN
      IF ABS(v_score) < 20 OR v_confidence_numeric < 65 THEN
        v_decision := 'HOLD';
      ELSE
        v_decision := CASE WHEN v_score > 0 THEN 'BUY' ELSE 'SELL' END;
      END IF;
    END IF;

    v_timeframe_text := v_valid_total::text
      || '/6 candle intervals have at least 26 valid candles';
    IF v_valid_total < 2 AND pg_catalog.array_length(v_stale_intervals, 1) > 0 THEN
      v_reason := 'STALE_CANDLE_DATA';
    ELSIF NOT v_snapshot_available THEN
      v_reason := 'WAIT: current market snapshot is missing, invalid, or stale; '
        || v_timeframe_text || '.';
    ELSIF v_valid_total < 2 THEN
      v_reason := 'WAIT: insufficient real candle history; '
        || v_timeframe_text || '.';
    ELSIF v_decision = 'HOLD' THEN
      v_reason := 'HOLD: market strength '
        || CASE WHEN v_score = 0 THEN '0'
                ELSE pg_catalog.trim_scale(v_score)::text END
        || ' is neutral or confidence is reduced by incomplete data; '
        || v_timeframe_text || '.';
    ELSE
      v_reason := v_decision
        || ': combined trend, momentum, RSI, MACD, volume, volatility, and 24-hour market data produced a '
        || CASE WHEN v_score = 0 THEN '0'
                ELSE pg_catalog.trim_scale(v_score)::text END
        || ' market-strength score.'
        || CASE WHEN v_total_invalid > 0
          THEN ' ' || v_total_invalid::text || ' invalid candle records were ignored.'
          ELSE '' END;
    END IF;

    v_market_data_indicator := pg_catalog.jsonb_build_object(
      'available', v_snapshot_available,
      'price', CASE WHEN v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.price ELSE NULL END,
      'dailyChangePct', CASE
        WHEN v_daily_change NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.daily_change ELSE NULL END,
      'volume', CASE WHEN v_volume >= 0
        AND v_volume NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.volume ELSE NULL END,
      'high24h', CASE WHEN v_high24h > 0
        AND v_high24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.high_24h ELSE NULL END,
      'low24h', CASE WHEN v_low24h >= 0
        AND v_low24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.low_24h ELSE NULL END,
      'rangePositionPct', v_range_position,
      'capturedAt', CASE WHEN v_snapshot_found
        THEN pg_catalog.to_jsonb(v_snapshot.captured_at) #>> '{}' ELSE NULL END,
      'stale', v_snapshot_stale
    );

    v_indicators := pg_catalog.jsonb_build_object(
      'marketData', v_market_data_indicator,
      'timeframes', v_timeframes,
      'marketStrength', v_score,
      'dataQuality', pg_catalog.jsonb_build_object(
        'candleIntervalsAvailable', pg_catalog.to_jsonb(v_valid_intervals),
        'candleIntervalsRequiredForAnalysis', 2,
        'candleCoverage', "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_candle_coverage * 100),
        'invalidCandlesIgnored', v_total_invalid,
        'staleCandleIntervals', pg_catalog.to_jsonb(v_stale_intervals),
        'staleCandlesIgnored', v_stale_ignored,
        'marketSnapshotAvailable', v_snapshot_available,
        'sufficientForDirectionalSignal', v_sufficient
          AND v_valid_total >= 4
          AND v_confidence_numeric >= 65
      )
    );

    INSERT INTO public."AI_Crypto_Bot_AI_Decisions" (
      symbol,
      decision,
      confidence,
      reason,
      indicators,
      strategy_name,
      strategy_version
    )
    VALUES (
      v_symbol,
      v_decision,
      v_confidence_numeric,
      v_reason,
      v_indicators,
      'Deterministic Technical Analysis',
      '1.0.0'
    );

    analyzed_markets := analyzed_markets + 1;
    decisions_stored := decisions_stored + 1;
    CASE v_decision
      WHEN 'BUY' THEN buy_count := buy_count + 1;
      WHEN 'SELL' THEN sell_count := sell_count + 1;
      WHEN 'HOLD' THEN hold_count := hold_count + 1;
      WHEN 'WAIT' THEN wait_count := wait_count + 1;
    END CASE;
  END LOOP;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(double precision)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
  double precision, double precision, double precision
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(
  double precision[], integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
  double precision[], double precision[], double precision[], double precision[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(double precision)
  TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
  double precision, double precision, double precision
) TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(
  double precision[], integer
) TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
  double precision[], double precision[], double precision[], double precision[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)
  TO service_role;

COMMIT;
